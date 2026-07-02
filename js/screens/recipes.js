import {
  getRecipeGroups, getRecipeSubCategories, getRecipes, getRecipe, getRecipesCatalogLayout,
  addRecipeGroup, addRecipeSubCategory, updateRecipeGroup, updateRecipeSubCategory,
  deleteRecipeGroup, deleteRecipeSubCategory, ensureRecipeTypeCatalog,
  addRecipe, updateRecipe, deleteRecipe, deleteAllRecipes, addRecipeIngredient, deleteRecipeIngredient,
  updateRecipeIngredient, syncProductCostFromRecipe, getRawMaterials, getSuppliers,
  setRecipeOrder, setRecipeGroupOrder, setRecipeSubCategoryOrder, moveRecipesToCategory,
  importParsedRecipes, scaleRecipeIngredients,
  findOrCreateWordImportCategory, IMPORT_WORD_GROUP, IMPORT_WORD_SUB,
  getExistingRecipeNameKeys, normalizeRecipeImportKey, formatRecipeIngredientsTotal,
  formatRecipeQuantity,
  getRecipeWeightSummary, formatKgWeight,
  computeRecipeProductUnits,
  RECIPE_WEIGHT_UNITS, normalizeRecipeUnitKind, RECIPE_SORT_GROUP_DEFAULT,
  RECIPE_OVEN_TYPES, normalizeRecipeBakingFields, resolveRecipeBaking,
  getRecipeOvenLabel, formatRecipeBakingParamsLine,
  getBakingProfiles, getBakingProfile, addBakingProfile, updateBakingProfile, deleteBakingProfile,
  getProductsForBakingProfile, getRecipesForBakingProfile, getBakingProfileScopes,
  linkProductToBakingProfile, unlinkProductFromBakingProfile,
  linkBakingProfileScope, unlinkBakingProfileScope,
  linkRecipeToBakingProfile, unlinkRecipeFromBakingProfile,
  countProductsUsingBakingProfile,
  BAKING_SCOPE_GROUP, BAKING_SCOPE_CATEGORY,
  buildMaterialsByNameKey, resolveRecipeIngredientMaterial, computeIngredientLineCost,
  computeRecipeMaterialsCost, getIngredientPriceSource, getMaterialsByIngredientName,
  computePricePerKg, pickHighestPricedMaterial,
} from '../kitchen-db.js?v=215';
import { getProducts, getProductsCatalogLayout } from '../db.js?v=215';
import { parseRecipesFromDocxFile, buildRecipeBookHtml } from '../recipe-import.js?v=215';
import { escapeHtml, showToast, formatMoney } from '../utils.js?v=215';
import { openModal, closeModal } from '../modal.js?v=215';
import {
  bindRecipeDragLists, bindCategoryDragList, bindCategoryGroupDragList,
} from '../product-drag.js?v=215';
import { defaultColorForIndex } from '../chart.js?v=215';

const EXPANDED_RECIPE_GROUPS_KEY = 'yitzurExpandedRecipeGroups';
const EXPANDED_RECIPE_CATS_KEY = 'yitzurExpandedRecipeCategories';
const RECIPE_TAB_KEY = 'yitzurRecipeTab';
const RECIPE_SEARCH_KEY = 'yitzurRecipeSearch';
const RECIPE_EDIT_SEARCH_KEY = 'yitzurRecipeEditSearch';
const RATIO_RECIPE_KEY = 'yitzurRatioRecipeId';
const RATIO_CAT_KEY = 'yitzurRatioRecipeCatId';

export const RECIPE_TABS = {
  browse: { id: 'browse', label: 'מתכונים', subtitle: 'צפייה, חיפוש וספר מתכונים' },
  edit: { id: 'edit', label: 'עריכה ובנייה', subtitle: 'הוספה, ייבוא Word וניהול קטגוריות' },
  baking: { id: 'baking', label: 'אפיות', subtitle: 'פרופילי אפייה ושיוך למתכונים' },
  ratio: { id: 'ratio', label: 'מחשבון יחס', subtitle: 'המרת כמויות לפי חומר בסיס' },
};

function getRecipeTab(container) {
  const tab = container?.dataset?.recipeTab || sessionStorage.getItem(RECIPE_TAB_KEY) || 'browse';
  return RECIPE_TABS[tab] ? tab : 'browse';
}

export function syncRecipesSubNav(activeTab) {
  document.querySelectorAll('.recipes-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.recipeTab === activeTab);
  });
}

export function updateRecipesHeader() {
  const tab = sessionStorage.getItem(RECIPE_TAB_KEY) || 'browse';
  const meta = RECIPE_TABS[tab];
  const el = document.getElementById('page-subtitle');
  if (el && meta) el.textContent = meta.subtitle;
}

export function switchRecipeTab(tab) {
  if (!RECIPE_TABS[tab]) return;
  const main = document.getElementById('main-content');
  main.dataset.recipeTab = tab;
  sessionStorage.setItem(RECIPE_TAB_KEY, tab);
  delete main.dataset.recipeBook;
  syncRecipesSubNav(tab);
  updateRecipesHeader();
  renderRecipes(main);
}

export function initRecipesSubNav() {
  document.querySelectorAll('.recipes-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchRecipeTab(btn.dataset.recipeTab));
  });
}

function filterRecipeLayout(layout, query) {
  const q = query.trim().toLowerCase();
  if (!q) return layout;
  const groups = layout.groups.map((g) => ({
    ...g,
    categories: g.categories
      .map((cat) => ({
        ...cat,
        recipes: cat.recipes.filter((r) => r.name.toLowerCase().includes(q)),
      }))
      .filter((cat) => cat.recipes.length > 0),
  })).filter((g) => g.categories.length > 0);
  return { ...layout, groups, allSubCategories: layout.allSubCategories };
}

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
const selectedRecipeIds = new Set();

function updateRecipeSelectionBar(container) {
  const bar = container.querySelector('#recipe-selection-bar');
  if (!bar) return;
  const count = selectedRecipeIds.size;
  bar.hidden = count === 0;
  const label = bar.querySelector('.recipe-selection-count');
  if (label) label.textContent = `${count} נבחרו`;
}

function renderRecipeItem(r, index, mode = 'edit') {
  if (mode === 'browse') {
    return `
    <div class="list-item recipe-list-item recipe-row-open recipe-row-browse" data-recipe-id="${r.id}" role="button" tabindex="0">
      <div class="list-item-info">
        <div class="list-item-name">${escapeHtml(r.name)}</div>
        <div class="list-item-meta">${r.yieldPortions || 1} מנות</div>
      </div>
      <span class="recipe-browse-chevron" aria-hidden="true">‹</span>
    </div>`;
  }
  const checked = selectedRecipeIds.has(r.id) ? 'checked' : '';
  const portionsMeta = r.showTotalAsPortions && r.yieldPortions
    ? `סה״כ ${formatRecipeQuantity(r.yieldPortions)} מנות`
    : `${r.yieldPortions || 1} מנות`;
  return `
    <div class="list-item recipe-list-item recipe-row-open" data-recipe-id="${r.id}" role="button" tabindex="0">
      <label class="recipe-select-wrap" title="בחר">
        <input type="checkbox" class="recipe-select-cb" data-id="${r.id}" ${checked}>
      </label>
      <div class="product-order-col">
        <span class="recipe-order-num product-order-num" aria-label="מיקום ${index + 1}">${index + 1}</span>
        <span class="recipe-drag-handle product-drag-handle" role="button" tabindex="0" aria-label="גרור לשינוי סדר">⠿</span>
      </div>
      <div class="list-item-info">
        <div class="list-item-name">${escapeHtml(r.name)}</div>
        <div class="list-item-meta">${portionsMeta}</div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn btn-secondary btn-sm recipe-portions-toggle${r.showTotalAsPortions ? ' active' : ''}" data-id="${r.id}" title="הצג סה״כ במנות">${r.showTotalAsPortions ? '🍽' : '⚖'}</button>
        <button type="button" class="btn btn-danger btn-sm delete-recipe" data-id="${r.id}">🗑</button>
      </div>
    </div>`;
}

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

function renderRecipeSubCategoryCard(cat, catIndex, mode = 'edit') {
  const isExpanded = expandedRecipeCategories.has(cat.id);
  const color = defaultColorForIndex(cat.id);
  const browseClass = mode === 'browse' ? ' category-card--browse' : '';
  const hint = mode === 'browse'
    ? 'לחץ על מתכון לצפייה מלאה'
    : 'לחץ על מתכון לצפייה · סמן ☑ להעברה · גרור ⠿ לשינוי סדר';
  return `
    <div class="card category-card${browseClass}${isExpanded ? ' is-expanded' : ''}" data-category-id="${cat.id}">
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
          <button type="button" class="btn btn-secondary btn-sm btn-icon edit-recipe-sub" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" title="עריכה">✏️</button>
          <button type="button" class="btn btn-danger btn-sm btn-icon delete-recipe-sub" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" data-count="${cat.recipes.length}">🗑</button>
        </div>
      </div>
      <div class="category-products-area">
        <div class="category-products-toolbar">
          <span class="category-products-label">מתכונים (${cat.recipes.length})</span>
          ${mode === 'edit' ? `<button type="button" class="btn btn-primary btn-sm add-recipe" data-cat="${cat.id}">+ מתכון</button>` : ''}
        </div>
        ${cat.recipes.length === 0
    ? (mode === 'browse'
      ? '<p class="category-products-empty">אין מתכונים בקטגוריה זו</p>'
      : '<p class="category-products-empty">אין מתכונים — הוסף או ייבא מ-Word</p>')
    : `<p class="product-drag-hint">${hint}</p>
           <div class="recipe-list" data-sub-id="${cat.id}">
             ${cat.recipes.map((r, i) => renderRecipeItem(r, i, mode)).join('')}
           </div>`}
      </div>
    </div>`;
}

function renderRecipeGroupCard(group, groupIndex, mode = 'edit') {
  const totalRecipes = group.categories.reduce((s, c) => s + c.recipes.length, 0);
  const isExpanded = expandedRecipeGroups.has(group.id);
  const color = defaultColorForIndex(group.id);
  const browseClass = mode === 'browse' ? ' category-group-card--browse' : '';
  const summary = mode === 'browse'
    ? `${group.categories.length} קטגוריות · ${totalRecipes} מתכונים`
    : `${group.categories.length} קטגוריות · ${totalRecipes} מתכונים · גרור לסידור`;
  return `
    <div class="card category-group-card${browseClass}${isExpanded ? ' is-expanded' : ''}" data-group-id="${group.id}">
      <div class="section-header category-group-header">
        <div class="category-header-start">
          <div class="category-order-col">
            <span class="product-order-num category-group-order-num" aria-label="מיקום ${groupIndex + 1}">${groupIndex + 1}</span>
            <span class="product-drag-handle category-group-drag-handle" role="button" tabindex="0" aria-label="גרור">⠿</span>
          </div>
          <button type="button" class="category-toggle category-group-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}">
            <span class="category-chevron" aria-hidden="true"></span>
            <span class="category-group-chip" style="${categoryChipStyle(color)}">📂 ${escapeHtml(group.name)}</span>
            <span class="category-summary">${summary}</span>
          </button>
        </div>
        <div class="category-actions">
          <button type="button" class="btn btn-secondary btn-sm btn-icon edit-recipe-group" data-id="${group.id}" data-name="${escapeHtml(group.name)}" title="עריכה">✏️</button>
          <button type="button" class="btn btn-danger btn-sm btn-icon delete-recipe-group" data-id="${group.id}" data-name="${escapeHtml(group.name)}">🗑</button>
        </div>
      </div>
      <div class="category-group-body">
        ${group.categories.length === 0
    ? '<p class="category-products-empty">אין קטגוריות — הוסף מילית, בצק וכו׳</p>'
    : `<div class="category-list" data-group-id="${group.id}">
            ${group.categories.map((cat, i) => renderRecipeSubCategoryCard(cat, i, mode)).join('')}
          </div>`}
      </div>
    </div>`;
}

function renderRecipeCatalogHTML(layout, mode = 'edit') {
  if (!layout.allSubCategories.length && !layout.groups.some((g) => g.categories.length)) {
    return `<div class="empty-state">
      <div class="empty-state-icon">📒</div>
      <p>${mode === 'browse' ? 'אין מתכונים עדיין' : 'הוסף קטגוריה (מילית, בצק...) או ייבא מ-Word'}</p>
      ${mode === 'browse' ? '<button type="button" class="btn btn-primary btn-sm" id="empty-go-edit">עבור לעריכה ובנייה</button>' : ''}
    </div>`;
  }
  const hint = mode === 'browse'
    ? 'לחץ על קטגוריה לפתיחה · לחץ על מתכון לצפייה'
    : 'קבוצות סידור — לחץ לפתיחה · גרור ⠿ · קטגוריות: מילית, בצק...';
  return `
    <p class="product-drag-hint">${hint}</p>
    <div class="category-group-list">
      ${layout.groups.map((g, i) => renderRecipeGroupCard(g, i, mode)).join('')}
    </div>`;
}

function bindCatalogToggles(container) {
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
}

function bindRecipeRowOpen(container, layout, productCatalog) {
  container._recipeLayout = layout;
  const openRecipeById = async (id) => {
    const recipe = await getRecipe(Number(id));
    if (recipe) openRecipeView(container, recipe, { productCatalog, layout });
  };
  container.querySelectorAll('.recipe-row-open').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.recipe-drag-handle, .delete-recipe, .recipe-select-wrap, .recipe-portions-toggle')) return;
      openRecipeById(row.dataset.recipeId);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('.recipe-drag-handle, .recipe-select-wrap')) return;
      e.preventDefault();
      openRecipeById(row.dataset.recipeId);
    });
  });
}

export function recipesMeta() {
  const tab = sessionStorage.getItem(RECIPE_TAB_KEY) || 'browse';
  const meta = RECIPE_TABS[tab];
  return { title: 'מתכונים', subtitle: meta?.subtitle || '' };
}

export async function renderRecipes(container) {
  const tab = getRecipeTab(container);
  container.dataset.recipeTab = tab;
  syncRecipesSubNav(tab);
  updateRecipesHeader();

  const [layout, productCatalog] = await Promise.all([
    getRecipesCatalogLayout(),
    getProductsCatalogLayout(),
  ]);

  if (!layout.groups.length) {
    await ensureRecipeTypeCatalog();
    return renderRecipes(container);
  }

  if (container.dataset.recipeBook === '1' && tab === 'browse') {
    const products = await getProducts(true);
    const productMap = new Map(products.map((p) => [p.id, p]));
    return renderRecipeBook(container, { groups: layout.groups, allSubs: layout.allSubCategories, productMap });
  }

  if (tab === 'browse') return renderRecipesBrowse(container, { layout, productCatalog });
  if (tab === 'edit') return renderRecipesEdit(container, { layout, productCatalog });
  if (tab === 'baking') return renderRecipesBaking(container, { layout, productCatalog });
  if (tab === 'ratio') return renderRecipesRatio(container, { layout });
}

async function renderRecipesBrowse(container, { layout, productCatalog }) {
  const savedSearch = sessionStorage.getItem(RECIPE_SEARCH_KEY) || '';
  const filtered = filterRecipeLayout(layout, savedSearch);
  const hasResults = filtered.groups.some((g) => g.categories.length > 0);

  container.innerHTML = `
    <div class="recipe-browse-toolbar">
      <input type="search" class="recipe-browse-search" id="recipe-search" placeholder="חיפוש מתכון..." value="${escapeHtml(savedSearch)}" autocomplete="off">
      <button type="button" class="btn btn-secondary btn-sm" id="recipe-book-btn">📖 ספר</button>
      <button type="button" class="btn btn-secondary btn-sm" id="recipe-print-book">🖨️</button>
    </div>
    ${hasResults
    ? renderRecipeCatalogHTML(filtered, 'browse')
    : `<div class="empty-state">
        <div class="empty-state-icon">${savedSearch ? '🔍' : '📒'}</div>
        <p>${savedSearch ? 'לא נמצאו מתכונים לחיפוש זה' : 'אין מתכונים עדיין'}</p>
        ${savedSearch ? '' : '<button type="button" class="btn btn-primary btn-sm" id="empty-go-edit">עבור לעריכה ובנייה</button>'}
      </div>`}`;

  document.getElementById('recipe-search')?.addEventListener('input', (e) => {
    sessionStorage.setItem(RECIPE_SEARCH_KEY, e.target.value);
    renderRecipesBrowse(container, { layout, productCatalog });
  });

  document.getElementById('empty-go-edit')?.addEventListener('click', () => switchRecipeTab('edit'));

  document.getElementById('recipe-book-btn')?.addEventListener('click', () => {
    container.dataset.recipeBook = '1';
    renderRecipes(container);
  });

  document.getElementById('recipe-print-book')?.addEventListener('click', async () => {
    container.dataset.recipeBook = '1';
    await renderRecipes(container);
    document.getElementById('print-recipe-book')?.click();
  });

  bindCatalogToggles(container);
  bindRecipeRowOpen(container, layout, productCatalog);
}

async function renderRecipesEdit(container, { layout, productCatalog }) {
  const savedSearch = sessionStorage.getItem(RECIPE_EDIT_SEARCH_KEY) || '';
  const filtered = filterRecipeLayout(layout, savedSearch);
  const hasResults = filtered.groups.some((g) => g.categories.length > 0);

  container.innerHTML = `
    <div class="card">
      <div class="filter-row" style="margin-bottom:8px">
        <div class="card-title" style="margin:0;flex:1">עריכה ובניית מתכונים</div>
        <label class="btn btn-secondary btn-sm backup-file-label" for="recipe-word-file">📄 Word
          <input type="file" id="recipe-word-file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
        </label>
        <button type="button" class="btn btn-secondary btn-sm" id="manage-recipe-cats">⚙️</button>
      </div>
    </div>
    <div class="recipe-browse-toolbar">
      <input type="search" class="recipe-browse-search" id="recipe-edit-search" placeholder="חיפוש מתכון..." value="${escapeHtml(savedSearch)}" autocomplete="off">
    </div>
    <div class="section-header products-toolbar">
      <h2>קטגוריות ומתכונים</h2>
      <div class="products-toolbar-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="add-recipe-group-btn">+ קבוצת סידור</button>
        <button type="button" class="btn btn-primary btn-sm" id="add-recipe-sub-btn">+ קטגוריה</button>
      </div>
    </div>
    ${hasResults
    ? renderRecipeCatalogHTML(filtered, 'edit')
    : `<div class="empty-state">
        <div class="empty-state-icon">${savedSearch ? '🔍' : '📒'}</div>
        <p>${savedSearch ? 'לא נמצאו מתכונים לחיפוש זה' : 'הוסף קטגוריה (מילית, בצק...) או ייבא מ-Word'}</p>
      </div>`}
    <div id="recipe-selection-bar" class="recipe-selection-bar" hidden>
      <span class="recipe-selection-count">0 נבחרו</span>
      <button type="button" class="btn btn-secondary btn-sm" id="recipe-clear-selection">נקה</button>
      <button type="button" class="btn btn-primary btn-sm" id="recipe-move-selected">העבר לקטגוריה</button>
    </div>
    <div class="recipe-delete-all-section">
      <button type="button" class="btn btn-danger" id="delete-all-recipes-btn">🗑️ מחק את כל המתכונים</button>
      <p class="form-hint">מוחק רק מתכונים — קטגוריות נשארות. מתאים לפני ייבוא מחדש מ-Word.</p>
    </div>`;

  document.getElementById('recipe-edit-search')?.addEventListener('input', (e) => {
    sessionStorage.setItem(RECIPE_EDIT_SEARCH_KEY, e.target.value);
    renderRecipesEdit(container, { layout, productCatalog });
  });

  document.getElementById('delete-all-recipes-btn')?.addEventListener('click', async () => {
    const count = layout.groups.reduce(
      (n, g) => n + g.categories.reduce((m, c) => m + c.recipes.length, 0),
      0,
    );
    if (!count) return showToast('אין מתכונים למחיקה');
    if (!confirm(`למחוק את כל ${count} המתכונים?\n\nהפעולה בלתי הפיכה. הקטגוריות יישארו — תוכל לייבא מחדש מ-Word.`)) return;
    try {
      await deleteAllRecipes();
      selectedRecipeIds.clear();
      showToast(`נמחקו ${count} מתכונים ✓`);
      renderRecipes(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('recipe-word-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = await parseRecipesFromDocxFile(file);
      if (parsed._parseWarning) showToast(parsed._parseWarning);
      const groups = await getRecipeGroups();
      openImportPreview(container, parsed, { groups, subs: [] });
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('manage-recipe-cats')?.addEventListener('click', () => {
    openCategoryManager(container, { groups: layout.groups });
  });

  document.getElementById('add-recipe-group-btn')?.addEventListener('click', () => {
    const name = prompt('שם קבוצת סידור:', RECIPE_SORT_GROUP_DEFAULT);
    if (!name?.trim()) return;
    addRecipeGroup({ name: name.trim(), linkedCategoryGroupId: null })
      .then(() => { showToast('נוסף ✓'); renderRecipes(container); })
      .catch((e) => showToast(e.message || 'שגיאה'));
  });

  document.getElementById('add-recipe-sub-btn')?.addEventListener('click', () => {
    openSubCategoryForm(container, layout.groups);
  });

  bindCatalogToggles(container);

  container.querySelectorAll('.add-recipe').forEach((btn) => {
    btn.addEventListener('click', () => {
      expandRecipeCategory(Number(btn.dataset.cat));
      openRecipeForm(container, { categoryId: Number(btn.dataset.cat), productCatalog });
    });
  });

  bindRecipeRowOpen(container, layout, productCatalog);

  container.querySelectorAll('.recipe-select-cb').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) selectedRecipeIds.add(id);
      else selectedRecipeIds.delete(id);
      updateRecipeSelectionBar(container);
    });
  });

  document.getElementById('recipe-clear-selection')?.addEventListener('click', () => {
    selectedRecipeIds.clear();
    container.querySelectorAll('.recipe-select-cb').forEach((cb) => { cb.checked = false; });
    updateRecipeSelectionBar(container);
  });

  document.getElementById('recipe-move-selected')?.addEventListener('click', () => {
    if (!selectedRecipeIds.size) return showToast('לא נבחרו מתכונים');
    openMoveRecipesModal(container, layout.groups, [...selectedRecipeIds]);
  });

  updateRecipeSelectionBar(container);

  container.querySelectorAll('.delete-recipe').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('למחוק מתכון?')) return;
      try {
        await deleteRecipe(Number(btn.dataset.id));
        selectedRecipeIds.delete(Number(btn.dataset.id));
        showToast('נמחק');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.recipe-portions-toggle').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const recipe = await getRecipe(id);
      if (!recipe) return;
      try {
        await updateRecipe(id, { showTotalAsPortions: !recipe.showTotalAsPortions });
        showToast(recipe.showTotalAsPortions ? 'סה״כ במשקל' : 'סה״כ במנות ✓');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.edit-recipe-group').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditSortGroupForm(container, {
        id: Number(btn.dataset.id),
        name: btn.dataset.name,
      });
    });
  });

  container.querySelectorAll('.delete-recipe-group').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`למחוק קבוצת סידור "${btn.dataset.name}"?`)) return;
      try {
        await deleteRecipeGroup(Number(btn.dataset.id));
        showToast('נמחק');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.edit-recipe-sub').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditSubCategoryForm(container, {
        id: Number(btn.dataset.id),
        name: btn.dataset.name,
        groups: layout.groups,
      });
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

async function renderRecipesRatio(container, { layout }) {
  const catOptions = buildRecipeCategorySelectOptions(layout);
  const savedCatId = sessionStorage.getItem(RATIO_CAT_KEY);
  const savedRecipeId = sessionStorage.getItem(RATIO_RECIPE_KEY);
  const defaultCatId = (savedCatId && catOptions.includes(`value="${savedCatId}"`))
    ? savedCatId
    : findFirstRecipeCategoryId(layout);
  const recipeOptions = buildRecipeSelectOptionsForCategory(layout, defaultCatId, savedRecipeId);
  const defaultRecipeId = savedRecipeId && recipeOptions.includes(`value="${savedRecipeId}"`)
    ? savedRecipeId
    : null;

  container.innerHTML = `
    <div class="card recipe-ratio-card">
      <div class="card-title">מחשבון יחס</div>
      <p class="form-hint" style="margin-bottom:12px">סמן חומר גלם לשינוי, הזן כמות יעד — או חשב לפי משקל יחידה ומספר יחידות.</p>
      ${catOptions ? `
      <div class="form-group">
        <label>קטגוריית מתכון</label>
        <select id="ratio-tab-cat-pick">${buildRecipeCategorySelectOptions(layout, defaultCatId)}</select>
      </div>
      <div class="form-group">
        <label>מתכון</label>
        <select id="ratio-tab-recipe-pick">${recipeOptions}</select>
      </div>
      <div id="ratio-tab-host"></div>` : `
      <div class="empty-state" style="padding:24px 0">
        <p>אין מתכונים עם חומרי גלם</p>
        <button type="button" class="btn btn-primary btn-sm" id="ratio-go-edit">עבור לעריכה ובנייה</button>
      </div>`}
    </div>`;

  document.getElementById('ratio-go-edit')?.addEventListener('click', () => switchRecipeTab('edit'));

  const catPick = document.getElementById('ratio-tab-cat-pick');
  const pick = document.getElementById('ratio-tab-recipe-pick');
  const host = document.getElementById('ratio-tab-host');

  const refreshRecipeOptions = () => {
    const catId = catPick?.value;
    if (catId) sessionStorage.setItem(RATIO_CAT_KEY, catId);
    if (!pick) return;
    const prev = pick.value;
    pick.innerHTML = buildRecipeSelectOptionsForCategory(layout, catId, prev);
    if (!pick.value && pick.options.length) pick.selectedIndex = 0;
  };

  const loadRecipe = async () => {
    const id = pick?.value;
    if (id) sessionStorage.setItem(RATIO_RECIPE_KEY, id);
    const recipe = await getRecipe(Number(id));
    if (!recipe || !host) return;
    bindRatioCalculator(recipe, host);
  };

  catPick?.addEventListener('change', () => {
    refreshRecipeOptions();
    loadRecipe();
  });
  pick?.addEventListener('change', loadRecipe);

  if (catOptions) {
    refreshRecipeOptions();
    if (defaultRecipeId && pick) pick.value = defaultRecipeId;
    await loadRecipe();
  }
}

function collectBakingRecipes(layout, profileMap) {
  const items = [];
  for (const group of layout.groups) {
    for (const cat of group.categories) {
      for (const recipe of cat.recipes) {
        const baking = resolveRecipeBaking(recipe, profileMap);
        if (!baking.hasBaking) continue;
        items.push({
          recipe,
          baking,
          categoryPath: `${group.name} › ${cat.name}`,
        });
      }
    }
  }
  return items;
}

function groupBakingByOven(items) {
  const groups = [
    { key: 'large', label: RECIPE_OVEN_TYPES.large, ovenLabel: RECIPE_OVEN_TYPES.large, paramsLine: '', items: [] },
    { key: 'small', label: RECIPE_OVEN_TYPES.small, ovenLabel: RECIPE_OVEN_TYPES.small, paramsLine: '', items: [] },
    { key: 'other', label: 'ללא סוג תנור / אחר', ovenLabel: '', paramsLine: '', items: [] },
  ];
  const map = new Map(groups.map((g) => [g.key, g]));
  for (const item of items) {
    const t = item.baking.bakeOvenType;
    const key = t === 'large' || t === 'small' ? t : 'other';
    map.get(key).items.push(item);
  }
  for (const g of groups) {
    g.items.sort((a, b) => a.recipe.name.localeCompare(b.recipe.name, 'he'));
  }
  return groups.filter((g) => g.items.length);
}

function renderBakingParamsCells(baking) {
  const cell = (value) => `<td class="baking-col-param">${value != null && value !== '' ? escapeHtml(String(value)) : '—'}</td>`;
  return `
    ${cell(baking.bakeTempC ? `${baking.bakeTempC}°` : null)}
    ${cell(baking.bakeTimeMinutes != null && baking.bakeTimeMinutes !== '' ? `${baking.bakeTimeMinutes} דק׳` : null)}
    ${cell(baking.bakeSteamSeconds != null && baking.bakeSteamSeconds !== '' ? `${baking.bakeSteamSeconds} שנ׳` : null)}
    ${cell(baking.bakeDryMinutes != null && baking.bakeDryMinutes !== '' ? `${baking.bakeDryMinutes} דק׳` : null)}`;
}

function renderBakingProfileCatalogRow(profile, productCount, recipeCount, scopeCounts = {}) {
  const oven = profile.bakeOvenType ? getRecipeOvenLabel(profile.bakeOvenType) : '—';
  const params = formatRecipeBakingParamsLine({}, profile) || '—';
  const scopeParts = [];
  if (scopeCounts.groups) scopeParts.push(`${scopeCounts.groups} קבוצות`);
  if (scopeCounts.categories) scopeParts.push(`${scopeCounts.categories} קטגוריות`);
  const scopeMeta = scopeParts.length ? `${scopeParts.join(' · ')} · ` : '';
  return `
    <div class="baking-profile-row baking-profile-row--clickable" data-profile-id="${profile.id}" role="button" tabindex="0">
      <div class="baking-profile-row-main">
        <strong class="baking-profile-name">${escapeHtml(profile.name)}</strong>
        <span class="baking-profile-meta">${escapeHtml(oven)} · ${escapeHtml(params)}</span>
        ${profile.notes ? `<span class="baking-profile-notes">${escapeHtml(profile.notes)}</span>` : ''}
      </div>
      <div class="baking-profile-row-side">
        <span class="baking-profile-count">${scopeMeta}${productCount} מוצרים · ${recipeCount} מתכונים</span>
        <button type="button" class="btn btn-primary btn-sm btn-icon link-baking-profile" data-id="${profile.id}" title="שייך קבוצה / קטגוריה / מוצר / מתכון">+</button>
        <button type="button" class="btn btn-secondary btn-sm btn-icon edit-baking-profile" data-id="${profile.id}" title="עריכת פרופיל">✏️</button>
        <button type="button" class="btn btn-danger btn-sm btn-icon delete-baking-profile" data-id="${profile.id}" title="מחיקה">🗑</button>
      </div>
    </div>`;
}

function renderBakingProfileGroupCard(group) {
  const subtitleParts = [];
  if (group.ovenLabel) subtitleParts.push(group.ovenLabel);
  if (group.paramsLine) subtitleParts.push(group.paramsLine);
  const subtitle = subtitleParts.length ? `<p class="baking-profile-group-params">${escapeHtml(subtitleParts.join(' · '))}</p>` : '';
  return `
    <div class="card baking-profile-group-card" data-profile-key="${escapeHtml(group.key)}">
      <div class="baking-oven-group-header">
        <div>
          <h3 class="baking-oven-group-title">🔥 ${escapeHtml(group.label)}</h3>
          ${subtitle}
        </div>
        <span class="baking-oven-group-count">${group.items.length} מתכונים</span>
      </div>
      <div class="baking-table-wrap">
        <table class="baking-table">
          <thead>
            <tr>
              <th scope="col" class="baking-col-name">מתכון</th>
              <th scope="col" class="baking-col-param">טמפ׳</th>
              <th scope="col" class="baking-col-param">זמן</th>
              <th scope="col" class="baking-col-param">קיטור</th>
              <th scope="col" class="baking-col-param">ליבוש</th>
            </tr>
          </thead>
          <tbody>
            ${group.items.map(({ recipe, baking, categoryPath }) => `
            <tr class="baking-row recipe-row-open" data-recipe-id="${recipe.id}" role="button" tabindex="0">
              <td class="baking-col-name">
                <strong class="baking-recipe-name">${escapeHtml(recipe.name)}</strong>
                <span class="baking-recipe-path">${escapeHtml(categoryPath)}</span>
              </td>
              ${renderBakingParamsCells(baking)}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function renderRecipesBaking(container, { layout, productCatalog }) {
  const profiles = await getBakingProfiles();
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const allItems = collectBakingRecipes(layout, profileMap);
  const groups = groupBakingByOven(allItems);
  const recipeCounts = new Map();
  const productCounts = new Map();
  const scopeCounts = new Map();
  for (const profile of profiles) {
    recipeCounts.set(profile.id, allItems.filter((i) => Number(i.recipe.bakingProfileId) === profile.id).length);
    productCounts.set(profile.id, await countProductsUsingBakingProfile(profile.id));
    const scopes = await getBakingProfileScopes(profile.id);
    scopeCounts.set(profile.id, { groups: scopes.groups.length, categories: scopes.categories.length });
  }

  const profileCatalog = profiles.length
    ? profiles.map((p) => renderBakingProfileCatalogRow(
      p,
      productCounts.get(p.id) || 0,
      recipeCounts.get(p.id) || 0,
      scopeCounts.get(p.id) || {},
    )).join('')
    : '<p class="form-hint baking-profile-empty">אין פרופילי אפייה — צור פרופיל ראשון</p>';

  container.innerHTML = `
    <div class="card baking-station-intro">
      <div class="card-title">רשימת אפיות</div>
      <p class="form-hint" style="margin:0">לחץ על פרופיל לניהול שיוכים · שייך לפי קבוצה, קטגוריה או מוצר · <strong>+</strong> לשיוך חדש</p>
    </div>
    <div class="card baking-profiles-card">
      <div class="section-header baking-profiles-header">
        <h2>פרופילי אפייה</h2>
        <button type="button" class="btn btn-primary btn-sm" id="add-baking-profile-btn">+ פרופיל</button>
      </div>
      <div class="baking-profile-list">${profileCatalog}</div>
    </div>
    ${allItems.length ? `
    <div class="section-header baking-recipes-header">
      <h2>מתכונים לפי סוג תנור</h2>
      <span class="baking-total-count">${allItems.length} מתכונים</span>
    </div>
    ${groups.map(renderBakingProfileGroupCard).join('')}` : `
    <div class="empty-state">
      <div class="empty-state-icon">🔥</div>
      <p>אין מתכונים עם אפייה עדיין</p>
      <p class="form-hint">צור פרופיל, או בעריכת מתכון סמן «כולל אפייה» ובחר פרופיל / הגדרות ידניות</p>
      <button type="button" class="btn btn-primary btn-sm" id="baking-go-edit">עבור לעריכה ובנייה</button>
    </div>`}`;

  document.getElementById('baking-go-edit')?.addEventListener('click', () => switchRecipeTab('edit'));

  document.getElementById('add-baking-profile-btn')?.addEventListener('click', () => {
    openBakingProfileForm(container, { layout, productCatalog });
  });

  const bakingCtx = { layout, productCatalog };
  const reopenLinks = (profileId, opts) => {
    openBakingProfileLinksModal(container, profileId, bakingCtx, opts);
  };

  container.querySelectorAll('.baking-profile-row--clickable').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      reopenLinks(Number(row.dataset.profileId));
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        reopenLinks(Number(row.dataset.profileId));
      }
    });
  });

  container.querySelectorAll('.link-baking-profile').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      reopenLinks(Number(btn.dataset.id), { focusAdd: true });
    });
  });

  container.querySelectorAll('.edit-baking-profile').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const profile = await getBakingProfile(Number(btn.dataset.id));
      if (profile) openBakingProfileForm(container, { profile, layout, productCatalog });
    });
  });

  container.querySelectorAll('.delete-baking-profile').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('למחוק פרופיל אפייה? השיוכים לקבוצות, קטגוריות, מוצרים ומתכונים יוסרו.')) return;
      try {
        await deleteBakingProfile(Number(btn.dataset.id));
        showToast('נמחק');
        renderRecipesBaking(container, { layout, productCatalog });
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  bindRecipeRowOpen(container, layout, productCatalog);
}

function buildCategorySelectOptions(groups, selectedId) {
  const parts = [];
  for (const group of groups) {
    for (const cat of group.categories) {
      const sel = Number(selectedId) === cat.id ? ' selected' : '';
      parts.push(`<option value="${cat.id}"${sel}>${escapeHtml(group.name)} › ${escapeHtml(cat.name)}</option>`);
    }
  }
  return parts.join('');
}

function buildRecipeCategorySelectOptions(layout, selectedCatId) {
  const parts = [];
  for (const group of layout.groups) {
    for (const cat of group.categories) {
      if (!cat.recipes.length) continue;
      const sel = Number(selectedCatId) === cat.id ? ' selected' : '';
      parts.push(`<option value="${cat.id}"${sel}>${escapeHtml(group.name)} › ${escapeHtml(cat.name)}</option>`);
    }
  }
  return parts.join('');
}

function buildRecipeSelectOptionsForCategory(layout, categoryId, selectedRecipeId) {
  if (!categoryId) return '';
  const parts = [];
  for (const group of layout.groups) {
    for (const cat of group.categories) {
      if (Number(cat.id) !== Number(categoryId)) continue;
      for (const r of cat.recipes) {
        const sel = Number(selectedRecipeId) === r.id ? ' selected' : '';
        parts.push(`<option value="${r.id}"${sel}>${escapeHtml(r.name)}</option>`);
      }
    }
  }
  return parts.join('');
}

function findFirstRecipeCategoryId(layout) {
  for (const group of layout.groups) {
    for (const cat of group.categories) {
      if (cat.recipes.length) return cat.id;
    }
  }
  return null;
}

function buildRecipeSelectOptions(layout) {
  const parts = [];
  for (const group of layout.groups) {
    for (const cat of group.categories) {
      for (const r of cat.recipes) {
        parts.push(`<option value="${r.id}">${escapeHtml(group.name)} › ${escapeHtml(cat.name)} › ${escapeHtml(r.name)}</option>`);
      }
    }
  }
  return parts.join('');
}

function openMoveRecipesModal(container, groups, recipeIds) {
  const options = buildCategorySelectOptions(groups);
  if (!options) return showToast('אין קטגוריות יעד');
  openModal({
    title: `העבר ${recipeIds.length} מתכונים`,
    bodyHTML: `
      <div class="form-group">
        <label>קטגוריית יעד</label>
        <select id="move-recipes-target">${options}</select>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="confirm-move-recipes">העבר</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('confirm-move-recipes')?.addEventListener('click', async () => {
    const targetId = Number(document.getElementById('move-recipes-target')?.value);
    try {
      const n = await moveRecipesToCategory(recipeIds, targetId);
      closeModal();
      selectedRecipeIds.clear();
      showToast(`הועברו ${n} מתכונים ✓`);
      renderRecipes(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function openSubCategoryForm(container, groups) {
  openModal({
    title: 'קטגוריה חדשה',
    bodyHTML: `
      <div class="form-group">
        <label>קבוצת סידור</label>
        <select id="new-sub-group">
          ${groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>שם קטגוריה</label>
        <input type="text" id="new-sub-name" placeholder="למשל: מילית, בצק, קרם...">
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

function openEditSubCategoryForm(container, { id, name, groups }) {
  openModal({
    title: 'עריכת קטגוריה',
    bodyHTML: `
      <div class="form-group">
        <label>קבוצת סידור</label>
        <select id="edit-sub-group">
          ${groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>שם קטגוריה</label>
        <input type="text" id="edit-sub-name" value="${escapeHtml(name)}">
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-edit-sub">שמור</button>`,
  });
  const current = groups.flatMap((g) => g.categories.map((c) => ({ ...c, groupId: g.id })))
    .find((c) => c.id === id);
  const groupSelect = document.getElementById('edit-sub-group');
  if (groupSelect && current) groupSelect.value = String(current.groupId);
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-edit-sub')?.addEventListener('click', async () => {
    const groupId = Number(document.getElementById('edit-sub-group')?.value);
    const newName = document.getElementById('edit-sub-name')?.value.trim();
    if (!newName) return showToast('הזן שם');
    try {
      await updateRecipeSubCategory(id, { name: newName, groupId });
      closeModal();
      showToast('נשמר ✓');
      renderRecipes(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function openEditSortGroupForm(container, { id, name }) {
  openModal({
    title: 'עריכת קבוצת סידור',
    bodyHTML: `
      <div class="form-group">
        <label>שם קבוצת סידור</label>
        <input type="text" id="edit-group-name" value="${escapeHtml(name)}">
      </div>
      <p class="form-hint">קבוצות סידור משמשות רק לסדר ברשימה — לא משפיעות על סוג המתכון.</p>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-edit-group">שמור</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-edit-group')?.addEventListener('click', async () => {
    const newName = document.getElementById('edit-group-name')?.value.trim();
    if (!newName) return showToast('הזן שם');
    try {
      await updateRecipeGroup(id, { name: newName });
      closeModal();
      showToast('נשמר ✓');
      renderRecipes(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function buildProductCategorySelectHTML(productCatalog, selectedId) {
  const parts = ['<option value="">— ללא (אופציונלי) —</option>'];
  const addCat = (cat, groupName) => {
    const sel = Number(selectedId) === cat.id ? 'selected' : '';
    const prefix = groupName ? `${groupName} › ` : '';
    parts.push(`<option value="${cat.id}" ${sel}>${escapeHtml(prefix)}${escapeHtml(cat.name)}</option>`);
  };
  for (const group of productCatalog.groups) {
    for (const cat of group.categories) addCat(cat, group.name);
  }
  for (const cat of productCatalog.ungrouped || []) addCat(cat, '');
  return parts.join('');
}

function collectProductsFromCatalog(productCatalog, categoryId) {
  const products = [];
  const pushCat = (cat) => {
    if (categoryId && Number(cat.id) !== Number(categoryId)) return;
    for (const p of cat.products || []) products.push(p);
  };
  for (const group of productCatalog.groups) {
    for (const cat of group.categories) pushCat(cat);
  }
  for (const cat of productCatalog.ungrouped || []) pushCat(cat);
  products.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return products;
}

function buildOptionalProductLinkerHTML(productCatalog, { linkedProductCategoryId, linkedProductIds }) {
  const categoryId = linkedProductCategoryId || '';
  const selected = new Set(linkedProductIds || []);
  const products = collectProductsFromCatalog(productCatalog, categoryId || null);
  const productList = categoryId
    ? (products.length
      ? products.map((p) => `
          <label class="checkbox-label recipe-product-pick">
            <input type="checkbox" class="recipe-product-cb" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>
            ${escapeHtml(p.name)}
          </label>`).join('')
      : '<p class="form-hint">אין מוצרים בקטגוריה זו</p>')
    : '<p class="form-hint">בחר קטגוריית מוצר (אופציונלי) כדי לקשר מוצרים</p>';
  return `
    <div class="form-group" style="margin-bottom:8px">
      <label>קטגוריית מוצר (אופציונלי)</label>
      <select id="recipe-product-category">${buildProductCategorySelectHTML(productCatalog, categoryId)}</select>
    </div>
    <div class="form-group" style="margin-bottom:0">
      <label>מוצרים מקושרים (אופציונלי)</label>
      <div class="recipe-product-picker" id="recipe-product-list" style="max-height:160px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
        ${productList}
      </div>
    </div>`;
}

function bindOptionalProductLinker(productCatalog, { linkedProductCategoryId, linkedProductIds }) {
  const catSelect = document.getElementById('recipe-product-category');
  const listHost = document.getElementById('recipe-product-list');
  if (!catSelect || !listHost) return;
  const refreshList = () => {
    const categoryId = catSelect.value ? Number(catSelect.value) : null;
    const selected = [...listHost.querySelectorAll('.recipe-product-cb:checked')].map((cb) => Number(cb.value));
    const products = collectProductsFromCatalog(productCatalog, categoryId);
    if (!categoryId) {
      listHost.innerHTML = '<p class="form-hint">בחר קטגוריית מוצר (אופציונלי) כדי לקשר מוצרים</p>';
      return;
    }
    if (!products.length) {
      listHost.innerHTML = '<p class="form-hint">אין מוצרים בקטגוריה זו</p>';
      return;
    }
    listHost.innerHTML = products.map((p) => `
      <label class="checkbox-label recipe-product-pick">
        <input type="checkbox" class="recipe-product-cb" value="${p.id}" ${selected.includes(p.id) ? 'checked' : ''}>
        ${escapeHtml(p.name)}
      </label>`).join('');
  };
  catSelect.addEventListener('change', refreshList);
}

async function renderRecipeBook(container, { groups, allSubs, productMap }) {
  const allRecipes = await getRecipes(null);
  const details = await Promise.all(allRecipes.map((r) => getRecipe(r.id)));

  container.innerHTML = `
    <div class="card">
      <div class="filter-row">
        <div class="card-title" style="margin:0;flex:1">📖 ספר מתכונים</div>
        <button type="button" class="btn btn-secondary btn-sm" id="recipe-manage-btn">← חזרה</button>
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
        const ingTotal = detail?.ingredients?.length ? renderRecipeTotalHTML(detail.ingredients) : '';
        return `
                <article class="recipe-book-item">
                  <h4>${escapeHtml(r.name)}</h4>
                  ${prodNames.length ? `<p class="form-hint">מוצרים: ${prodNames.map((n) => escapeHtml(n)).join(', ')}</p>` : ''}
                  ${detail?.notes ? `<p class="recipe-book-notes">${escapeHtml(detail.notes)}</p>` : ''}
                  ${detail?.ingredients?.length ? `
                  <ul class="recipe-book-ingredients">
                    ${detail.ingredients.map((ing) => `
                      <li>${escapeHtml(ing.name)} — <strong>${formatRecipeQuantity(ing.quantity)}</strong> ${escapeHtml(ing.unit)}</li>`).join('')}
                  </ul>
                  ${ingTotal ? `<p class="recipe-ingredients-total">${ingTotal}</p>` : ''}` : ''}
                </article>`;
      }).join('')}
            </section>`;
    }).join('')}
        </section>`;
  }).join('') || '<p class="form-hint">אין מתכונים</p>'}
    </div>`;

  document.getElementById('recipe-manage-btn')?.addEventListener('click', () => {
    delete container.dataset.recipeBook;
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

function openCategoryManager(container, { groups }) {
  const groupRows = groups.map((g) => `
    <div class="filter-row recipe-mgr-row">
      <span style="flex:1">📂 ${escapeHtml(g.name)}</span>
      <button type="button" class="btn btn-secondary btn-sm mgr-edit-group" data-id="${g.id}" data-name="${escapeHtml(g.name)}">✏️</button>
      <button type="button" class="btn btn-danger btn-sm mgr-del-group" data-id="${g.id}" data-name="${escapeHtml(g.name)}">🗑</button>
    </div>`).join('');

  const catRows = groups.flatMap((g) => g.categories.map((cat) => `
    <div class="filter-row recipe-mgr-row">
      <span style="flex:1">${escapeHtml(g.name)} › <strong>${escapeHtml(cat.name)}</strong> · ${cat.recipes.length} מתכונים</span>
      <button type="button" class="btn btn-secondary btn-sm mgr-edit-cat" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}">✏️</button>
      <button type="button" class="btn btn-danger btn-sm mgr-del-cat" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" data-count="${cat.recipes.length}">🗑</button>
    </div>`)).join('');

  openModal({
    title: 'ניהול קטגוריות וסידור',
    bodyHTML: `
      <p class="form-hint" style="margin-bottom:12px">
        <strong>קבוצות סידור</strong> — רק לסדר ברשימה (גרירה במסך הראשי).<br>
        <strong>קטגוריות</strong> — סוג המתכון: מילית, בצק, קרם... ניתן להוסיף ולערוך בחופשיות.
      </p>
      <h3 class="recipe-mgr-heading">קבוצות סידור</h3>
      ${groupRows || '<p class="form-hint">אין קבוצות</p>'}
      <button type="button" class="btn btn-secondary btn-sm" id="mgr-add-group" style="width:100%;margin:8px 0 16px">+ קבוצת סידור</button>
      <h3 class="recipe-mgr-heading">קטגוריות מתכונים</h3>
      ${catRows || '<p class="form-hint">אין קטגוריות</p>'}
      <button type="button" class="btn btn-primary btn-sm" id="mgr-add-cat" style="width:100%;margin-top:8px">+ קטגוריה</button>`,
    footerHTML: '<button class="btn btn-primary modal-cancel">סגור</button>',
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  document.getElementById('mgr-add-group')?.addEventListener('click', () => {
    closeModal();
    const name = prompt('שם קבוצת סידור:', RECIPE_SORT_GROUP_DEFAULT);
    if (!name?.trim()) return;
    addRecipeGroup({ name: name.trim(), linkedCategoryGroupId: null })
      .then(() => { showToast('נוסף ✓'); renderRecipes(container); })
      .catch((e) => showToast(e.message || 'שגיאה'));
  });

  document.getElementById('mgr-add-cat')?.addEventListener('click', () => {
    closeModal();
    openSubCategoryForm(container, groups);
  });

  document.querySelectorAll('.mgr-edit-group').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal();
      openEditSortGroupForm(container, { id: Number(btn.dataset.id), name: btn.dataset.name });
    });
  });

  document.querySelectorAll('.mgr-del-group').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`למחוק קבוצת סידור "${btn.dataset.name}"?`)) return;
      try {
        await deleteRecipeGroup(Number(btn.dataset.id));
        closeModal();
        showToast('נמחק');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.querySelectorAll('.mgr-edit-cat').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal();
      openEditSubCategoryForm(container, {
        id: Number(btn.dataset.id),
        name: btn.dataset.name,
        groups,
      });
    });
  });

  document.querySelectorAll('.mgr-del-cat').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (Number(btn.dataset.count) > 0) {
        showToast('יש מתכונים בקטגוריה — העבר או מחק קודם');
        return;
      }
      if (!confirm(`למחוק קטגוריה "${btn.dataset.name}"?`)) return;
      try {
        await deleteRecipeSubCategory(Number(btn.dataset.id));
        closeModal();
        showToast('נמחק');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });
}

function formatImportRecipePath(r) {
  const parts = [];
  if (r.groupName) parts.push(r.groupName);
  if (r.subName) parts.push(r.subName);
  return parts.length ? parts.join(' › ') : IMPORT_WORD_GROUP;
}

function renderImportRecipePick(r, i, existingNames) {
  const isDup = existingNames.has(normalizeRecipeImportKey(r.title));
  const selected = true;
  return `
    <label
      class="import-recipe-pick${selected ? ' is-selected' : ''}${isDup ? ' is-duplicate' : ''}"
      data-idx="${i}">
      <input type="checkbox" class="import-recipe-cb" data-idx="${i}" ${selected ? 'checked' : ''} aria-label="בחר ${escapeHtml(r.title)}">
      <span class="import-pick-body">
        <strong>${escapeHtml(r.title)}</strong>
        <span class="form-hint"> · ${escapeHtml(formatImportRecipePath(r))}</span>
        · ${(r.ingredients || []).length} חומרים
        ${isDup ? ' · <span class="import-dup-badge">קיים</span>' : ''}
        ${!(r.ingredients || []).length ? ' · <span class="import-warn-badge">ללא חומרים</span>' : ''}
      </span>
    </label>`;
}

function bindImportRecipePickers() {
  const list = document.querySelector('.import-recipe-pick-list');
  const selectAll = document.getElementById('import-select-all');
  const getCheckboxes = () => [...document.querySelectorAll('.import-recipe-cb')];

  const syncRowStyles = () => {
    document.querySelectorAll('.import-recipe-pick').forEach((row) => {
      const cb = row.querySelector('.import-recipe-cb');
      row.classList.toggle('is-selected', !!cb?.checked);
    });
  };

  const syncSelectAll = () => {
    const all = getCheckboxes();
    if (!selectAll) return;
    if (!all.length) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      return;
    }
    const checked = all.filter((cb) => cb.checked);
    selectAll.checked = checked.length === all.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
  };

  list?.addEventListener('change', (e) => {
    if (!e.target.classList.contains('import-recipe-cb')) return;
    syncRowStyles();
    syncSelectAll();
  });

  selectAll?.addEventListener('change', () => {
    getCheckboxes().forEach((cb) => { cb.checked = selectAll.checked; });
    syncRowStyles();
    syncSelectAll();
  });

  syncRowStyles();
  syncSelectAll();
}

function getSelectedImportRecipes(parsed) {
  return [...document.querySelectorAll('.import-recipe-cb:checked')]
    .map((cb) => parsed[Number(cb.dataset.idx)])
    .filter(Boolean);
}

function countDuplicateImportTitles(parsed) {
  const seen = new Map();
  for (const r of parsed) {
    const key = normalizeRecipeImportKey(r.title) || `__empty_${seen.size}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  let dupRows = 0;
  for (const n of seen.values()) {
    if (n > 1) dupRows += n;
  }
  return dupRows;
}

function openImportPreview(container, parsed, { groups, subs }) {
  if (!Array.isArray(parsed) || !parsed.length) {
    showToast('לא נמצאו מתכונים בקובץ');
    return;
  }
  getExistingRecipeNameKeys().then((existingNames) => {
    const newCount = parsed.filter((r) => !existingNames.has(normalizeRecipeImportKey(r.title))).length;
    const dupCount = parsed.length - newCount;
    const dupTitleRows = countDuplicateImportTitles(parsed);
    const allNew = newCount === parsed.length;
    openModal({
      title: `ייבוא ${parsed.length} מתכונים`,
      bodyHTML: `
        <p class="form-hint" style="margin-bottom:10px">
          סמן ✓ את המתכונים לייבוא · כותרות מהקובץ יהפכו ל<strong>קטגוריות</strong>.
          ${dupCount ? `<br>כבר קיימים במערכת: <strong>${dupCount}</strong> — יסומנו «קיים».` : ''}
          ${newCount ? `<br>חדשים: <strong>${newCount}</strong>` : ''}
          ${dupTitleRows ? `<br><strong>${dupTitleRows}</strong> שורות עם שם כפול בקובץ — ייובאו כולן (עם סיומת אם צריך).` : ''}
        </p>
        <div class="form-group">
          <label>קבוצת סידור (אם אין בקובץ)</label>
          <select id="import-group">
            <option value="word-import" selected>${escapeHtml(IMPORT_WORD_GROUP)}</option>
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
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="import-update-qty"${allNew ? '' : ' checked'}>
            עדכן כמויות במתכונים קיימים (תיקון עיגול / שברים)
          </label>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="import-skip-dupes"${allNew ? '' : ' checked'}>
            דלג על מתכונים קיימים (בזמן ייבוא חדש)
          </label>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="import-select-all" checked>
            סמן הכל ✓
          </label>
        </div>
        <div class="import-recipe-pick-list">
          ${parsed.map((r, i) => renderImportRecipePick(r, i, existingNames)).join('')}
        </div>`,
      footerHTML: `
        <button class="btn btn-secondary modal-cancel">ביטול</button>
        <button class="btn btn-primary" id="confirm-recipe-import">ייבוא מסומנים ✓</button>`,
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    bindImportRecipePickers();
    document.getElementById('confirm-recipe-import')?.addEventListener('click', async () => {
      let gid = document.getElementById('import-group')?.value;
      const addRawMaterials = document.getElementById('import-add-materials')?.checked !== false;
      const skipDupes = document.getElementById('import-skip-dupes')?.checked !== false;
      const updateQty = document.getElementById('import-update-qty')?.checked !== false;
      let selected = getSelectedImportRecipes(parsed);
      const selectAllEl = document.getElementById('import-select-all');
      if (selectAllEl?.checked && selected.length < parsed.length) {
        selected = parsed.slice();
      }
      if (!selected.length) return showToast('סמן לפחות מתכון אחד ✓');
      if (skipDupes && !updateQty) {
        const before = selected.length;
        selected = selected.filter((r) => !existingNames.has(normalizeRecipeImportKey(r.title)));
        if (!selected.length) {
          return showToast('כל המסומנים כבר קיימים — בטל «דלג על קיימים» או סמן «עדכן כמויות»');
        }
        if (before > selected.length) {
          showToast(`דולגו ${before - selected.length} מתכונים קיימים`);
        }
      }
      try {
        let defaultGroupId;
        let defaultSubId;
        if (gid === 'word-import' || !gid) {
          const loc = await findOrCreateWordImportCategory();
          defaultGroupId = loc.groupId;
          defaultSubId = loc.subCategoryId;
        } else {
          defaultGroupId = Number(gid);
          const subList = await getRecipeSubCategories(defaultGroupId);
          defaultSubId = subList[0]?.id;
        }
        const result = await importParsedRecipes(selected, {
          groupId: defaultGroupId,
          subCategoryId: defaultSubId,
          addRawMaterials,
          skipDuplicates: skipDupes,
          updateExistingQuantities: updateQty,
        });
        closeModal();
        const parts = [];
        if (result.imported) parts.push(`יובאו ${result.imported}`);
        if (result.quantitiesUpdated) parts.push(`עודכנו כמויות ב-${result.quantitiesUpdated}`);
        if (result.skippedDuplicate) parts.push(`דולגו ${result.skippedDuplicate} קיימים`);
        else if (result.skipped) parts.push(`דולגו ${result.skipped}`);
        if (result.failed) parts.push(`${result.failed} נכשלו`);
        showToast(`${parts.join(' · ') || 'בוצע'} ✓`);
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  }).catch((err) => {
    showToast(err?.message || 'שגיאה בפתיחת תצוגת ייבוא');
  });
}

function renderRecipeWeightSummaryHTML(ingredients, recipe, options) {
  const summary = getRecipeWeightSummary(ingredients, { ...options, recipe });
  if (!summary.mainText) return '';

  const unitGrams = recipe?.portionWeightGrams ? Number(recipe.portionWeightGrams) : null;
  const yieldP = Number(recipe?.yieldPortions) || 1;
  const units = unitGrams && summary.totalRecipeKg > 0
    ? computeRecipeProductUnits(summary.totalRecipeKg, yieldP, unitGrams)
    : null;

  let estimateHtml = '';
  if (!unitGrams && summary.totalRecipeKg > 0 && yieldP > 1) {
    const gPerPortion = Math.round((summary.totalRecipeKg * 1000) / yieldP);
    if (gPerPortion > 0) {
      estimateHtml = `<p class="recipe-weight-estimate">משקל משוער למנה: ${gPerPortion} גרם (${yieldP} מנות)</p>`;
    }
  }

  const unitWeightHtml = unitGrams
    ? `<div class="recipe-portion-weight-line"><span>משקל מוצר יחידה:</span> <strong>${unitGrams} גרם</strong></div>`
    : '';

  const unitsHtml = units
    ? `<div class="recipe-unit-yield-line">
        <span>ממנה אחת:</span> <strong>${formatRecipeQuantity(units.unitsPerPortion)} יחידות</strong>
        <span class="recipe-unit-yield-total"> · סה״כ מהמתכון: ${formatRecipeQuantity(units.totalUnits)} יחידות</span>
      </div>`
    : '';

  return `
    <div class="recipe-weight-summary">
      <div class="recipe-weight-main">
        <span class="recipe-weight-label">סה"כ משקל מתכון</span>
        <strong class="recipe-weight-value">${escapeHtml(summary.mainText)}</strong>
      </div>
      ${summary.breakdownText ? `<div class="recipe-weight-breakdown">${escapeHtml(summary.breakdownText)}</div>` : ''}
      ${unitWeightHtml}
      ${unitsHtml}
      ${estimateHtml}
    </div>`;
}

function renderRecipeTotalHTML(ingredients, recipe, options) {
  return renderRecipeWeightSummaryHTML(ingredients, recipe, options);
}

function readIngredientsFromForm(baseIngredients) {
  return (baseIngredients || []).map((ing) => {
    const row = document.querySelector(`.recipe-ing-row[data-ing-id="${ing.id}"]`);
    return {
      ...ing,
      quantity: row?.querySelector('.ing-qty')?.value ?? ing.quantity,
      unitKind: row?.querySelector('.ing-unit')?.value ?? ing.unitKind ?? normalizeRecipeUnitKind(ing.unit),
    };
  });
}

function getRecipeFormContext(baseRecipe) {
  const portionRaw = document.getElementById('recipe-portion-weight')?.value;
  return {
    ...(baseRecipe || {}),
    yieldPortions: document.getElementById('recipe-yield')?.value,
    portionWeightGrams: portionRaw ? Number(portionRaw) : null,
    showTotalAsPortions: document.getElementById('recipe-show-portions')?.checked || false,
  };
}

function buildRecipeMaterialContext(mats, suppliers) {
  return {
    matById: new Map(mats.map((m) => [m.id, m])),
    byNameKey: buildMaterialsByNameKey(mats),
    supMap: new Map(suppliers.map((s) => [s.id, s.name])),
  };
}

function resolveIngredientDisplay(ing, ctx) {
  const { mat, priceSource } = resolveRecipeIngredientMaterial(ing, ctx);
  const lineCost = computeIngredientLineCost(ing, mat);
  const ppk = mat ? computePricePerKg(mat.unitPrice, mat.packageWeightGrams) : null;
  let badge = 'ללא מחיר';
  if (mat) {
    if (priceSource === 'max') badge = 'מחיר מקס׳ (אוטומטי)';
    else badge = ctx.supMap.get(mat.supplierId) || 'ספק';
  }
  return { mat, lineCost, badge, priceSource, ppk };
}

function renderRecipeCostSummaryHTML(ingredients, ctx) {
  let total = 0;
  for (const ing of ingredients || []) {
    total += resolveIngredientDisplay(ing, ctx).lineCost;
  }
  if (!ingredients?.length) return '';
  return `
    <div class="recipe-cost-summary">
      <span class="recipe-cost-label">עלות חומרי גלם למתכון</span>
      <strong class="recipe-cost-value">${formatMoney(total)}</strong>
      <span class="form-hint">מחירים מספקים · ברירת מחדל: הגבוה ביותר</span>
    </div>`;
}

function renderRecipeCostAndWeightHTML(ingredients, recipe, ctx, options) {
  return renderRecipeCostSummaryHTML(ingredients, ctx)
    + renderRecipeWeightSummaryHTML(ingredients, recipe, options);
}

function renderRecipeIngredientRowHTML(ing, ctx) {
  const kind = ing.unitKind || normalizeRecipeUnitKind(ing.unit);
  const { lineCost, badge, mat } = resolveIngredientDisplay(ing, ctx);
  return `
    <div class="filter-row recipe-ing-row" style="margin-bottom:6px;align-items:center" data-ing-id="${ing.id}">
      <button type="button" class="recipe-ing-name pick-ing-supplier" data-ing-id="${ing.id}" title="לחץ לעריכת חומר גלם">
        <span class="recipe-ing-name-text">${escapeHtml(ing.name)}</span>
        <span class="recipe-ing-price-meta">${mat ? formatMoney(lineCost) : '—'} · ${escapeHtml(badge)}</span>
      </button>
      <input type="number" class="ing-qty" min="0.001" step="0.001" value="${formatRecipeQuantity(ing.quantity)}" style="width:80px">
      <select class="ing-unit" style="width:72px">
        ${RECIPE_WEIGHT_UNITS.map((u) => `
          <option value="${u.id}" ${kind === u.id ? 'selected' : ''}>${u.label}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-danger btn-sm del-ing" data-id="${ing.id}">🗑</button>
    </div>`;
}

async function openIngredientSupplierPicker(container, recipe, ing, ctx, mats, productCatalog, catalogLayout, returnToView) {
  const offers = await getMaterialsByIngredientName(ing.name);
  const currentSource = getIngredientPriceSource(ing);
  const maxMat = pickHighestPricedMaterial(offers);
  openModal({
    title: `עריכת חומר · ${escapeHtml(ing.name)}`,
    bodyHTML: `
      <div class="form-group" style="margin-top:0">
        <label for="change-ing-mat-search">החלף חומר גלם</label>
        <div class="mat-search-wrap" style="position:relative">
          <input type="text" id="change-ing-mat-search" value="${escapeHtml(ing.name)}" placeholder="חפש חומר גלם..." autocomplete="off">
          <input type="hidden" id="change-ing-mat-id" value="">
          <ul class="mat-search-list hidden" id="change-ing-mat-list"></ul>
        </div>
        <p class="form-hint">בחר מהרשימה או הזן שם ידנית</p>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="change-ing-mat-btn" style="width:100%;margin-bottom:16px">החלף חומר</button>
      <hr style="border:none;border-top:1px solid var(--border);margin:0 0 16px">
      <p class="form-hint" style="margin-top:0">תמחור — ברירת מחדל: המחיר הגבוה ביותר מבין הספקים</p>
      <div class="ing-price-picker">
        <button type="button" class="ing-price-option${currentSource === 'max' ? ' active' : ''}" data-source="max">
          <span class="ing-price-option-name">מחיר גבוה ביותר (אוטומטי)</span>
          <span class="ing-price-option-meta">${maxMat ? formatMoney(materialComparisonPriceDisplay(maxMat)) + '/ק"ג משוער' : 'אין מחירים'}</span>
        </button>
        ${offers.map((m) => {
    const sup = ctx.supMap.get(m.supplierId) || 'ספק';
    const ppk = computePricePerKg(m.unitPrice, m.packageWeightGrams);
    const isActive = currentSource === 'supplier' && Number(ing.rawMaterialId) === m.id;
    return `
        <button type="button" class="ing-price-option${isActive ? ' active' : ''}" data-source="supplier" data-mid="${m.id}">
          <span class="ing-price-option-name">${escapeHtml(sup)}</span>
          <span class="ing-price-option-meta">${formatMoney(m.unitPrice)}/${escapeHtml(m.unit)}${ppk != null ? ` · ${formatMoney(ppk)}/ק"ג` : ''}</span>
        </button>`;
  }).join('')}
      </div>`,
    footerHTML: '<button class="btn btn-secondary modal-cancel">סגור</button>',
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  bindMaterialSearch(
    mats,
    document.getElementById('change-ing-mat-search'),
    document.getElementById('change-ing-mat-id'),
    document.getElementById('change-ing-mat-list'),
  );

  const reloadAfterIngredientChange = async (toastMsg) => {
    try { await syncProductCostFromRecipe(recipe.id); } catch { /* no products */ }
    closeModal();
    openRecipeForm(container, {
      recipe: await getRecipe(recipe.id), productCatalog, layout: catalogLayout, returnToView,
    });
    showToast(toastMsg);
  };

  document.getElementById('change-ing-mat-btn')?.addEventListener('click', async () => {
    const matId = Number(document.getElementById('change-ing-mat-id')?.value);
    const searchName = document.getElementById('change-ing-mat-search')?.value.trim();
    let mat = mats.find((m) => m.id === matId);
    if (!mat && searchName) {
      mat = mats.find((m) => m.name === searchName)
        || mats.find((m) => m.name.toLowerCase() === searchName.toLowerCase());
    }
    const newName = mat?.name || searchName;
    if (!newName) return showToast('בחר או הזן שם חומר');
    if (newName === ing.name) return showToast('אותו חומר');
    try {
      await updateRecipeIngredient(ing.id, {
        name: newName,
        priceSource: 'max',
        rawMaterialId: null,
      });
      await reloadAfterIngredientChange('חומר הוחלף ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.querySelectorAll('.ing-price-option').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const source = btn.dataset.source;
        const patch = source === 'supplier'
          ? { priceSource: 'supplier', rawMaterialId: Number(btn.dataset.mid) }
          : { priceSource: 'max', rawMaterialId: null };
        await updateRecipeIngredient(ing.id, patch);
        await reloadAfterIngredientChange('תמחור עודכן ✓');
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });
}

function materialComparisonPriceDisplay(mat) {
  const ppk = computePricePerKg(mat?.unitPrice, mat?.packageWeightGrams);
  return ppk != null ? ppk : (Number(mat?.unitPrice) || 0);
}

function refreshRecipeTotalDisplay(baseIngredients, baseRecipe, ctx) {
  const el = document.getElementById('recipe-ing-total');
  if (!el) return;
  el.innerHTML = renderRecipeCostAndWeightHTML(
    readIngredientsFromForm(baseIngredients),
    getRecipeFormContext(baseRecipe),
    ctx,
  );
}

function formatRatioFactor(r) {
  if (!Number.isFinite(r) || r <= 0) return '—';
  const rounded = Math.round(r * 1000) / 1000;
  if (Math.abs(rounded - 1) < 0.001) return '1';
  return String(rounded).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function bindRatioCalculator(recipe, hostEl) {
  const ingredients = recipe.ingredients || [];
  if (!ingredients.length) {
    hostEl.innerHTML = '<p class="form-hint">אין חומרים במתכון זה</p>';
    return;
  }

  const state = {
    anchorId: ingredients[0].id,
    targetQty: Number(ingredients[0].quantity),
    cakeWeightGrams: recipe.portionWeightGrams ? String(recipe.portionWeightGrams) : '',
    cakeCount: '',
    scaleFromCakes: false,
  };

  const getAnchor = () => ingredients.find((i) => i.id === Number(state.anchorId));

  const getOriginalTotalGrams = () => {
    const { totalRecipeKg } = getRecipeWeightSummary(ingredients);
    return totalRecipeKg > 0 ? totalRecipeKg * 1000 : 0;
  };

  const applyScaleFromCakes = () => {
    const cakeW = Number(state.cakeWeightGrams);
    const count = Number(state.cakeCount);
    const origG = getOriginalTotalGrams();
    const anchor = getAnchor();
    if (!cakeW || !count || !origG || !anchor) return false;
    const targetTotalG = count * cakeW;
    const ratio = targetTotalG / origG;
    state.targetQty = Math.round(Number(anchor.quantity) * ratio * 1000) / 1000;
    state.scaleFromCakes = true;
    return true;
  };

  const render = () => {
    const anchor = getAnchor();
    if (!anchor) return;

    const baseQty = Number(anchor.quantity);
    const targetQty = Number(state.targetQty);
    let scaled;
    let ratio = 1;
    try {
      scaled = scaleRecipeIngredients(ingredients, state.anchorId, targetQty);
      ratio = targetQty / baseQty;
    } catch (err) {
      hostEl.querySelector('#ratio-tbody')?.replaceChildren();
      hostEl.querySelector('#ratio-change-banner')?.replaceChildren();
      const errEl = hostEl.querySelector('#ratio-error');
      if (errEl) errEl.textContent = err.message || 'שגיאה';
      return;
    }

    const errEl = hostEl.querySelector('#ratio-error');
    if (errEl) errEl.textContent = '';

    const origTotalG = getOriginalTotalGrams();
    const cakeW = Number(state.cakeWeightGrams);
    const unitsInfo = cakeW && origTotalG
      ? computeRecipeProductUnits(origTotalG / 1000, recipe.yieldPortions, cakeW)
      : null;

    const scaledSummary = getRecipeWeightSummary(scaled, { useScaled: true });
    const scaledTotalG = scaledSummary.totalRecipeKg * 1000;
    const cakeCountNum = Number(state.cakeCount);

    const bannerEl = hostEl.querySelector('#ratio-change-banner');
    if (bannerEl) {
      bannerEl.innerHTML = `
        <div class="ratio-change-banner-inner">
          <span class="ratio-change-label">שינוי יחס — ${escapeHtml(anchor.name)}</span>
          <span class="ratio-change-values">
            מ-<strong>${baseQty}</strong> ${escapeHtml(anchor.unit)}
            ל-<strong>${targetQty}</strong> ${escapeHtml(anchor.unit)}
          </span>
          <span class="ratio-factor-badge">×${formatRatioFactor(ratio)}</span>
        </div>`;
    }

    const tbody = hostEl.querySelector('#ratio-tbody');
    if (tbody) {
      tbody.innerHTML = scaled.map((ing) => {
        const isAnchor = ing.id === Number(state.anchorId);
        const orig = ingredients.find((i) => i.id === ing.id);
        return `
        <tr class="ratio-ing-row${isAnchor ? ' ratio-anchor-row is-anchor-selected' : ''}" data-ing-id="${ing.id}">
          <td class="ratio-pick-col">
            <input type="radio" name="ratio-anchor-pick" value="${ing.id}" ${isAnchor ? 'checked' : ''} aria-label="שנה לפי ${escapeHtml(ing.name)}">
          </td>
          <td>${escapeHtml(ing.name)}</td>
          <td class="ratio-col-orig">${formatRecipeQuantity(orig?.quantity)} ${escapeHtml(ing.unit)}</td>
          <td class="ratio-col-calc"><strong>${ing.scaledQuantity}</strong> ${escapeHtml(ing.unit)}</td>
        </tr>`;
      }).join('') + (() => {
        const totalHtml = renderRecipeWeightSummaryHTML(scaled, recipe, { useScaled: true });
        return totalHtml
          ? `<tr class="recipe-total-row"><td colspan="4">${totalHtml}</td></tr>`
          : '';
      })();
    }

    const yieldEl = hostEl.querySelector('#ratio-yield-result');
    if (yieldEl) {
      if (unitsInfo) {
        yieldEl.innerHTML = `ממנה אחת: <strong>${formatRecipeQuantity(unitsInfo.unitsPerPortion)}</strong> יחידות · סה״כ מתכון: <strong>${formatRecipeQuantity(unitsInfo.totalUnits)}</strong> (${cakeW} גרם ליחידה)`;
        yieldEl.hidden = false;
      } else {
        yieldEl.hidden = true;
        yieldEl.innerHTML = '';
      }
    }

    const cakesResultEl = hostEl.querySelector('#ratio-cakes-result');
    if (cakesResultEl) {
      if (state.scaleFromCakes && cakeCountNum > 0 && cakeW > 0) {
        cakesResultEl.innerHTML = `
          המתכון מותאם ל-<strong>${cakeCountNum}</strong> יחידות × ${cakeW} גרם
          = <strong>${Math.round(cakeCountNum * cakeW)}</strong> גרם
          (סה"כ מחושב: ${Math.round(scaledTotalG)} גרם)`;
        cakesResultEl.hidden = false;
      } else {
        cakesResultEl.hidden = true;
        cakesResultEl.innerHTML = '';
      }
    }

    hostEl.querySelectorAll('.ratio-ing-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('input[type="radio"]')) return;
        const id = Number(row.dataset.ingId);
        state.anchorId = id;
        state.scaleFromCakes = false;
        const ing = ingredients.find((i) => i.id === id);
        state.targetQty = Number(ing?.quantity) || state.targetQty;
        hostEl.querySelector(`input[name="ratio-anchor-pick"][value="${id}"]`)?.click();
        render();
      });
    });

    hostEl.querySelectorAll('input[name="ratio-anchor-pick"]').forEach((radio) => {
      radio.onclick = (e) => e.stopPropagation();
      radio.onchange = () => {
        state.anchorId = Number(radio.value);
        state.scaleFromCakes = false;
        const ing = ingredients.find((i) => i.id === state.anchorId);
        state.targetQty = Number(ing?.quantity) || 1;
        const targetInput = hostEl.querySelector('#ratio-target');
        if (targetInput) targetInput.value = state.targetQty;
        render();
      };
    });
  };

  hostEl.innerHTML = `
    <p class="form-hint ratio-intro">סמן את חומר הגלם שברצונך לשנות — שאר הכמויות יתעדכנו אוטומטית.</p>
    <div id="ratio-change-banner" class="ratio-change-banner"></div>
    <div id="ratio-error" class="ratio-error" role="alert"></div>
    <div class="form-group">
      <label>כמות יעד לחומר שנבחר</label>
      <input type="number" id="ratio-target" min="0.001" step="0.001" value="${formatRecipeQuantity(ingredients[0].quantity)}">
    </div>
    <div class="ratio-table-wrap">
      <table class="ratio-table">
        <thead>
          <tr>
            <th class="ratio-pick-col" scope="col"></th>
            <th scope="col">חומר גלם</th>
            <th scope="col">מקור</th>
            <th scope="col">מחושב</th>
          </tr>
        </thead>
        <tbody id="ratio-tbody"></tbody>
      </table>
    </div>
    <div class="ratio-cake-tools">
      <h3 class="ratio-cake-tools-title">חישוב לפי יחידות</h3>
      <div class="ratio-cake-grid">
        <div class="form-group">
          <label>משקל מוצר יחידה (גרם)</label>
          <input type="number" id="ratio-cake-weight" min="1" step="1" placeholder="למשל: 85" value="${escapeHtml(state.cakeWeightGrams)}">
        </div>
        <div class="form-group">
          <label>כמה יחידות רוצה?</label>
          <input type="number" id="ratio-cake-count" min="0.1" step="0.1" placeholder="למשל: 10" value="">
        </div>
      </div>
      <p id="ratio-yield-result" class="ratio-yield-result" hidden></p>
      <p id="ratio-cakes-result" class="ratio-cakes-result" hidden></p>
    </div>`;

  hostEl.querySelector('#ratio-target')?.addEventListener('input', (e) => {
    state.scaleFromCakes = false;
    state.targetQty = Number(e.target.value);
    state.cakeCount = '';
    const countInput = hostEl.querySelector('#ratio-cake-count');
    if (countInput) countInput.value = '';
    render();
  });

  hostEl.querySelector('#ratio-cake-weight')?.addEventListener('input', (e) => {
    state.cakeWeightGrams = e.target.value;
    if (state.cakeCount) applyScaleFromCakes();
    render();
  });

  hostEl.querySelector('#ratio-cake-count')?.addEventListener('input', (e) => {
    state.cakeCount = e.target.value;
    if (state.cakeCount && state.cakeWeightGrams) {
      applyScaleFromCakes();
      const targetInput = hostEl.querySelector('#ratio-target');
      if (targetInput) targetInput.value = state.targetQty;
    } else {
      state.scaleFromCakes = false;
    }
    render();
  });

  render();
}

function findRecipeCategoryPath(layout, categoryId) {
  if (!layout?.groups) return '';
  for (const group of layout.groups) {
    for (const cat of group.categories) {
      if (Number(cat.id) === Number(categoryId)) {
        if (layout.groups.length > 1) return `${group.name} › ${cat.name}`;
        return cat.name;
      }
    }
  }
  return '';
}

function findProductCategoryName(productCatalog, categoryId) {
  if (!categoryId || !productCatalog) return '';
  for (const group of productCatalog.groups) {
    for (const cat of group.categories) {
      if (Number(cat.id) === Number(categoryId)) {
        return group.name ? `${group.name} › ${cat.name}` : cat.name;
      }
    }
  }
  for (const cat of productCatalog.ungrouped || []) {
    if (Number(cat.id) === Number(categoryId)) return cat.name;
  }
  return '';
}

function buildBakingParamsFieldsHTML(values, { idPrefix = 'recipe' } = {}) {
  const oven = values?.bakeOvenType || '';
  const isPreset = oven === 'large' || oven === 'small';
  const isCustom = oven && !isPreset;
  return `
        <div class="form-group" style="margin-top:12px">
          <label>סוג תנור</label>
          <div class="recipe-oven-type-row">
            <label class="checkbox-label">
              <input type="radio" name="${idPrefix}-oven-type" value="large" ${oven === 'large' ? 'checked' : ''}>
              ${escapeHtml(RECIPE_OVEN_TYPES.large)}
            </label>
            <label class="checkbox-label">
              <input type="radio" name="${idPrefix}-oven-type" value="small" ${oven === 'small' ? 'checked' : ''}>
              ${escapeHtml(RECIPE_OVEN_TYPES.small)}
            </label>
            <label class="checkbox-label">
              <input type="radio" name="${idPrefix}-oven-type" value="custom" ${isCustom ? 'checked' : ''}>
              אחר
            </label>
          </div>
          <input type="text" id="${idPrefix}-oven-custom" class="recipe-oven-custom${isCustom ? '' : ' hidden'}" maxlength="40" placeholder="למשל: תנור הילוך, תנור רצפתי..." value="${isCustom ? escapeHtml(oven) : ''}">
          <p class="form-hint">אפייה שונה לפי גודל התנור — ניתן להוסיף סוגים נוספים</p>
        </div>
        <div class="recipe-baking-grid">
          <div class="form-group">
            <label>טמפ׳ אפייה (°C)</label>
            <input type="number" id="${idPrefix}-bake-temp" min="1" max="500" step="1" placeholder="180" value="${values?.bakeTempC ?? ''}">
          </div>
          <div class="form-group">
            <label>זמן אפייה (דק׳)</label>
            <input type="number" id="${idPrefix}-bake-time" min="0" step="1" placeholder="25" value="${values?.bakeTimeMinutes ?? ''}">
          </div>
          <div class="form-group">
            <label>קיטור (שניות)</label>
            <input type="number" id="${idPrefix}-bake-steam" min="0" step="1" placeholder="30" value="${values?.bakeSteamSeconds ?? ''}">
          </div>
          <div class="form-group">
            <label>ליבוש (דק׳)</label>
            <input type="number" id="${idPrefix}-bake-dry" min="0" step="1" placeholder="10" value="${values?.bakeDryMinutes ?? ''}">
          </div>
        </div>`;
}

function buildBakingProfileSelectOptions(profiles, selectedId) {
  const parts = ['<option value="">— הגדרות ידניות —</option>'];
  for (const p of profiles) {
    const sel = Number(selectedId) === p.id ? ' selected' : '';
    const oven = p.bakeOvenType ? getRecipeOvenLabel(p.bakeOvenType) : '';
    const params = formatRecipeBakingParamsLine({}, p);
    const hint = [oven, params].filter(Boolean).join(' · ');
    parts.push(`<option value="${p.id}"${sel}>${escapeHtml(p.name)}${hint ? ` (${escapeHtml(hint)})` : ''}</option>`);
  }
  return parts.join('');
}

function bindBakingParamsFormToggle(idPrefix) {
  const customInput = document.getElementById(`${idPrefix}-oven-custom`);
  document.querySelectorAll(`input[name="${idPrefix}-oven-type"]`).forEach((radio) => {
    radio.addEventListener('change', () => {
      const isCustom = document.querySelector(`input[name="${idPrefix}-oven-type"]:checked`)?.value === 'custom';
      customInput?.classList.toggle('hidden', !isCustom);
      if (isCustom) customInput?.focus();
    });
  });
}

function readBakingParamsFromForm(idPrefix) {
  const ovenEl = document.querySelector(`input[name="${idPrefix}-oven-type"]:checked`);
  let bakeOvenType = null;
  if (ovenEl?.value === 'large' || ovenEl?.value === 'small') {
    bakeOvenType = ovenEl.value;
  } else if (ovenEl?.value === 'custom') {
    bakeOvenType = document.getElementById(`${idPrefix}-oven-custom`)?.value?.trim() || null;
  }
  return {
    bakeTempC: document.getElementById(`${idPrefix}-bake-temp`)?.value,
    bakeTimeMinutes: document.getElementById(`${idPrefix}-bake-time`)?.value,
    bakeSteamSeconds: document.getElementById(`${idPrefix}-bake-steam`)?.value,
    bakeDryMinutes: document.getElementById(`${idPrefix}-bake-dry`)?.value,
    bakeOvenType,
  };
}

function buildRecipeBakingFormHTML(recipe, profiles = []) {
  const enabled = !!recipe?.hasBaking || !!recipe?.bakingProfileId;
  const profileId = recipe?.bakingProfileId || '';
  const profileOptions = buildBakingProfileSelectOptions(profiles, profileId);
  const useProfile = !!profileId;
  return `
    <div class="form-group recipe-baking-block">
      <label class="checkbox-label recipe-baking-toggle">
        <input type="checkbox" id="recipe-has-baking" ${enabled ? 'checked' : ''}>
        <span>🔥 כולל אפייה</span>
      </label>
      <div id="recipe-baking-fields" class="recipe-baking-fields${enabled ? '' : ' hidden'}">
        <div class="form-group" style="margin-top:12px">
          <label>פרופיל אפייה</label>
          <select id="recipe-baking-profile">${profileOptions}</select>
          <p class="form-hint">בחר פרופיל קיים או השאר «הגדרות ידניות» למתכון ספציפי</p>
        </div>
        <div id="recipe-baking-manual-fields" class="${useProfile ? 'hidden' : ''}">
          ${buildBakingParamsFieldsHTML(recipe, { idPrefix: 'recipe' })}
        </div>
        <div id="recipe-baking-profile-preview" class="baking-profile-preview${useProfile ? '' : ' hidden'}"></div>
      </div>
    </div>`;
}

function bindRecipeBakingFormToggle(profiles = []) {
  const cb = document.getElementById('recipe-has-baking');
  const fields = document.getElementById('recipe-baking-fields');
  const profileSelect = document.getElementById('recipe-baking-profile');
  const manualFields = document.getElementById('recipe-baking-manual-fields');
  const preview = document.getElementById('recipe-baking-profile-preview');

  const refreshProfilePreview = () => {
    const profileId = Number(profileSelect?.value);
    const profile = profiles.find((p) => p.id === profileId);
    const useProfile = !!profile;
    manualFields?.classList.toggle('hidden', useProfile);
    preview?.classList.toggle('hidden', !useProfile);
    if (!preview) return;
    if (!profile) {
      preview.innerHTML = '';
      return;
    }
    const rows = [];
    if (profile.bakeOvenType) rows.push({ label: 'תנור', value: getRecipeOvenLabel(profile.bakeOvenType) });
    if (profile.bakeTempC) rows.push({ label: 'טמפ׳', value: `${profile.bakeTempC}°C` });
    if (profile.bakeTimeMinutes != null && profile.bakeTimeMinutes !== '') {
      rows.push({ label: 'זמן', value: `${profile.bakeTimeMinutes} דק׳` });
    }
    if (profile.bakeSteamSeconds != null && profile.bakeSteamSeconds !== '') {
      rows.push({ label: 'קיטור', value: `${profile.bakeSteamSeconds} שנ׳` });
    }
    if (profile.bakeDryMinutes != null && profile.bakeDryMinutes !== '') {
      rows.push({ label: 'ליבוש', value: `${profile.bakeDryMinutes} דק׳` });
    }
    preview.innerHTML = `
      <p class="form-hint" style="margin-bottom:8px">פרטים מפרופיל «${escapeHtml(profile.name)}»</p>
      <div class="recipe-baking-view-grid">
        ${rows.map((r) => `
        <div class="recipe-baking-view-item">
          <span class="recipe-baking-view-label">${escapeHtml(r.label)}</span>
          <strong class="recipe-baking-view-value">${escapeHtml(r.value)}</strong>
        </div>`).join('') || '<p class="form-hint">פרופיל ללא פרטים</p>'}
      </div>`;
  };

  cb?.addEventListener('change', () => {
    fields?.classList.toggle('hidden', !cb.checked);
  });
  profileSelect?.addEventListener('change', refreshProfilePreview);
  bindBakingParamsFormToggle('recipe');
  refreshProfilePreview();
}

function readBakingFromForm() {
  const hasBaking = document.getElementById('recipe-has-baking')?.checked;
  if (!hasBaking) {
    return normalizeRecipeBakingFields({ hasBaking: false });
  }
  const profileId = document.getElementById('recipe-baking-profile')?.value;
  if (profileId) {
    return normalizeRecipeBakingFields({ hasBaking: true, bakingProfileId: profileId });
  }
  return normalizeRecipeBakingFields({
    hasBaking: true,
    ...readBakingParamsFromForm('recipe'),
  });
}

function buildRecipeBakingViewHTML(recipe, profileMap) {
  const baking = resolveRecipeBaking(recipe, profileMap);
  if (!baking.hasBaking) return '';
  const rows = [];
  if (baking.profileName) rows.push({ label: 'פרופיל', value: baking.profileName });
  if (baking.bakeOvenType) rows.push({ label: 'תנור', value: getRecipeOvenLabel(baking.bakeOvenType) });
  if (baking.bakeTempC) rows.push({ label: 'טמפ׳ אפייה', value: `${baking.bakeTempC}°C` });
  if (baking.bakeTimeMinutes != null && baking.bakeTimeMinutes !== '') {
    rows.push({ label: 'זמן אפייה', value: `${baking.bakeTimeMinutes} דק׳` });
  }
  if (baking.bakeSteamSeconds != null && baking.bakeSteamSeconds !== '') {
    rows.push({ label: 'קיטור', value: `${baking.bakeSteamSeconds} שניות` });
  }
  if (baking.bakeDryMinutes != null && baking.bakeDryMinutes !== '') {
    rows.push({ label: 'ליבוש', value: `${baking.bakeDryMinutes} דק׳` });
  }
  if (!rows.length) {
    return `
      <section class="recipe-sheet-section recipe-baking-section">
        <h2 class="recipe-sheet-section-title">🔥 אפייה</h2>
        <p class="recipe-sheet-empty">מסומן כולל אפייה — הוסף פרטים בעריכה</p>
      </section>`;
  }
  return `
    <section class="recipe-sheet-section recipe-baking-section">
      <h2 class="recipe-sheet-section-title">🔥 אפייה</h2>
      <div class="recipe-baking-view-grid">
        ${rows.map((r) => `
        <div class="recipe-baking-view-item">
          <span class="recipe-baking-view-label">${escapeHtml(r.label)}</span>
          <strong class="recipe-baking-view-value">${escapeHtml(r.value)}</strong>
        </div>`).join('')}
      </div>
    </section>`;
}

function buildProductCategorySelectOptions(productCatalog, selectedId) {
  const parts = ['<option value="">בחר קטגוריה...</option>'];
  for (const group of productCatalog.groups) {
    for (const cat of group.categories) {
      if (!cat.products?.length) continue;
      const sel = Number(selectedId) === cat.id ? ' selected' : '';
      parts.push(`<option value="${cat.id}"${sel}>${escapeHtml(group.name)} › ${escapeHtml(cat.name)}</option>`);
    }
  }
  for (const cat of productCatalog.ungrouped || []) {
    if (!cat.products?.length) continue;
    const sel = Number(selectedId) === cat.id ? ' selected' : '';
    parts.push(`<option value="${cat.id}"${sel}>${escapeHtml(cat.name)}</option>`);
  }
  return parts.join('');
}

function buildProductsSelectForCategory(productCatalog, categoryId, linkedProductIds) {
  const cat = productCatalog.allCategories.find((c) => Number(c.id) === Number(categoryId));
  if (!cat?.products?.length) return '<option value="">אין מוצרים</option>';
  const linked = new Set(linkedProductIds || []);
  const available = cat.products.filter((p) => p.active !== false && !linked.has(p.id));
  if (!available.length) return '<option value="">כל המוצרים כבר משויכים</option>';
  return available.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}

function collectAvailableRecipesForBaking(layout, profileId) {
  const items = [];
  for (const group of layout.groups) {
    for (const cat of group.categories) {
      for (const recipe of cat.recipes) {
        if (Number(recipe.bakingProfileId) === Number(profileId)) continue;
        items.push({ recipe, path: `${group.name} › ${cat.name}` });
      }
    }
  }
  return items.sort((a, b) => a.recipe.name.localeCompare(b.recipe.name, 'he'));
}

function findProductCategoryPath(productCatalog, categoryId) {
  for (const group of productCatalog.groups) {
    for (const cat of group.categories) {
      if (Number(cat.id) === Number(categoryId)) return `${group.name} › ${cat.name}`;
    }
  }
  const cat = productCatalog.allCategories.find((c) => Number(c.id) === Number(categoryId));
  return cat?.name || '';
}

function findRecipePathById(layout, recipeId) {
  for (const group of layout.groups) {
    for (const cat of group.categories) {
      if (cat.recipes.some((r) => r.id === recipeId)) return `${group.name} › ${cat.name}`;
    }
  }
  return '';
}

function buildProductGroupSelectOptions(productCatalog, selectedId, linkedGroupIds) {
  const linked = new Set(linkedGroupIds || []);
  const parts = ['<option value="">בחר קבוצה...</option>'];
  for (const group of productCatalog.groups) {
    if (linked.has(group.id)) continue;
    const sel = Number(selectedId) === group.id ? ' selected' : '';
    parts.push(`<option value="${group.id}"${sel}>${escapeHtml(group.name)}</option>`);
  }
  return parts.join('');
}

function buildProductCategoryScopeSelectOptions(productCatalog, selectedId, linkedCategoryIds) {
  const linked = new Set(linkedCategoryIds || []);
  const parts = ['<option value="">בחר קטגוריה...</option>'];
  for (const group of productCatalog.groups) {
    for (const cat of group.categories) {
      if (linked.has(cat.id)) continue;
      const sel = Number(selectedId) === cat.id ? ' selected' : '';
      parts.push(`<option value="${cat.id}"${sel}>${escapeHtml(group.name)} › ${escapeHtml(cat.name)}</option>`);
    }
  }
  for (const cat of productCatalog.ungrouped || []) {
    if (linked.has(cat.id)) continue;
    const sel = Number(selectedId) === cat.id ? ' selected' : '';
    parts.push(`<option value="${cat.id}"${sel}>${escapeHtml(cat.name)}</option>`);
  }
  return parts.join('');
}

function findProductGroupName(productCatalog, groupId) {
  const group = productCatalog.groups.find((g) => Number(g.id) === Number(groupId));
  return group?.name || '';
}

function buildBakingScopeAddRowHTML(scopeType, productCatalog, {
  linkedGroupIds, linkedCategoryIds, linkedProductIds, defaultProductCat,
}) {
  if (scopeType === 'group') {
    return `
      <select id="baking-link-scope-pick" style="flex:1">${buildProductGroupSelectOptions(productCatalog, '', linkedGroupIds)}</select>
      <button type="button" class="btn btn-primary btn-sm" id="baking-link-scope-btn">+</button>`;
  }
  if (scopeType === 'category') {
    return `
      <select id="baking-link-scope-pick" style="flex:1">${buildProductCategoryScopeSelectOptions(productCatalog, '', linkedCategoryIds)}</select>
      <button type="button" class="btn btn-primary btn-sm" id="baking-link-scope-btn">+</button>`;
  }
  return `
    <select id="baking-link-product-cat" style="flex:1">${buildProductCategorySelectOptions(productCatalog, defaultProductCat)}</select>
    <select id="baking-link-product-pick" style="flex:1">${buildProductsSelectForCategory(productCatalog, defaultProductCat, linkedProductIds)}</select>
    <button type="button" class="btn btn-primary btn-sm" id="baking-link-scope-btn">+</button>`;
}

async function openBakingProfileLinksModal(container, profileId, { layout, productCatalog }, { focusAdd = false } = {}) {
  const profile = await getBakingProfile(profileId);
  if (!profile) return showToast('פרופיל לא נמצא');

  const [linkedProducts, linkedRecipes, scopes] = await Promise.all([
    getProductsForBakingProfile(profileId),
    getRecipesForBakingProfile(profileId),
    getBakingProfileScopes(profileId),
  ]);
  const { groups: linkedGroups, categories: linkedCategories } = scopes;

  const availableRecipes = collectAvailableRecipesForBaking(layout, profileId);
  const linkedProductIds = linkedProducts.map((p) => p.id);
  const linkedGroupIds = linkedGroups.map((s) => s.scopeId);
  const linkedCategoryIds = linkedCategories.map((s) => s.scopeId);
  const defaultProductCat = productCatalog.allCategories.find((c) => c.products?.length)?.id || '';
  const defaultScopeType = 'group';
  const recipeOptions = availableRecipes.length
    ? availableRecipes.map(({ recipe, path }) => `<option value="${recipe.id}">${escapeHtml(recipe.name)} (${escapeHtml(path)})</option>`).join('')
    : '<option value="">אין מתכונים לשיוך</option>';

  const paramsLine = formatRecipeBakingParamsLine({}, profile);

  openModal({
    title: `שיוך · ${escapeHtml(profile.name)}`,
    bodyHTML: `
      ${paramsLine ? `<p class="form-hint baking-links-params">${escapeHtml(paramsLine)}</p>` : ''}
      <div class="baking-links-section">
        <div class="baking-links-section-head">
          <h3 class="baking-links-title">קבוצות (${linkedGroups.length})</h3>
        </div>
        ${linkedGroups.length ? `
          <ul class="baking-links-list">
            ${linkedGroups.map((s) => `
              <li class="baking-links-item">
                <div class="baking-links-item-info">
                  <strong>${escapeHtml(s.group?.name || findProductGroupName(productCatalog, s.scopeId))}</strong>
                  <span class="form-hint">קטגוריה כללית · כל המוצרים בקבוצה</span>
                </div>
                <button type="button" class="btn btn-danger btn-sm unlink-baking-scope" data-scope-type="${BAKING_SCOPE_GROUP}" data-scope-id="${s.scopeId}">הסר</button>
              </li>`).join('')}
          </ul>` : '<p class="form-hint baking-links-empty">אין קבוצות משויכות</p>'}
      </div>
      <div class="baking-links-section">
        <div class="baking-links-section-head">
          <h3 class="baking-links-title">קטגוריות (${linkedCategories.length})</h3>
        </div>
        ${linkedCategories.length ? `
          <ul class="baking-links-list">
            ${linkedCategories.map((s) => `
              <li class="baking-links-item">
                <div class="baking-links-item-info">
                  <strong>${escapeHtml(findProductCategoryName(productCatalog, s.scopeId) || s.category?.name || '')}</strong>
                  <span class="form-hint">קטגוריה · כל המוצרים בקטגוריה</span>
                </div>
                <button type="button" class="btn btn-danger btn-sm unlink-baking-scope" data-scope-type="${BAKING_SCOPE_CATEGORY}" data-scope-id="${s.scopeId}">הסר</button>
              </li>`).join('')}
          </ul>` : '<p class="form-hint baking-links-empty">אין קטגוריות משויכות</p>'}
      </div>
      <div class="baking-links-section">
        <div class="baking-links-section-head">
          <h3 class="baking-links-title">מוצרים (${linkedProducts.length})</h3>
        </div>
        ${linkedProducts.length ? `
          <ul class="baking-links-list">
            ${linkedProducts.map((p) => `
              <li class="baking-links-item">
                <div class="baking-links-item-info">
                  <strong>${escapeHtml(p.name)}</strong>
                  <span class="form-hint">${escapeHtml(findProductCategoryPath(productCatalog, p.categoryId))}</span>
                </div>
                <button type="button" class="btn btn-danger btn-sm unlink-baking-product" data-product-id="${p.id}">הסר</button>
              </li>`).join('')}
          </ul>` : '<p class="form-hint baking-links-empty">אין מוצרים משויכים ישירות</p>'}
        <p class="form-hint">שיוך ישיר למוצר גובר על שיוך לפי קטגוריה או קבוצה</p>
      </div>
      <div class="baking-links-add baking-scope-add${focusAdd ? ' baking-links-add--focus' : ''}" id="baking-add-scope-block">
        <label class="baking-links-add-label">הוסף שיוך</label>
        <div class="baking-scope-type-row" role="radiogroup" aria-label="סוג שיוך">
          <label class="baking-scope-type-option"><input type="radio" name="baking-scope-type" value="group"${defaultScopeType === 'group' ? ' checked' : ''}> קטגוריה כללית</label>
          <label class="baking-scope-type-option"><input type="radio" name="baking-scope-type" value="category"${defaultScopeType === 'category' ? ' checked' : ''}> קטגוריה</label>
          <label class="baking-scope-type-option"><input type="radio" name="baking-scope-type" value="product"${defaultScopeType === 'product' ? ' checked' : ''}> מוצר</label>
        </div>
        <div class="filter-row" id="baking-scope-add-row">
          ${buildBakingScopeAddRowHTML(defaultScopeType, productCatalog, {
    linkedGroupIds, linkedCategoryIds, linkedProductIds, defaultProductCat,
  })}
        </div>
      </div>
      <div class="baking-links-section">
        <div class="baking-links-section-head">
          <h3 class="baking-links-title">מתכונים (${linkedRecipes.length})</h3>
        </div>
        ${linkedRecipes.length ? `
          <ul class="baking-links-list">
            ${linkedRecipes.map((r) => `
              <li class="baking-links-item">
                <div class="baking-links-item-info">
                  <strong>${escapeHtml(r.name)}</strong>
                  <span class="form-hint">${escapeHtml(findRecipePathById(layout, r.id))}</span>
                </div>
                <button type="button" class="btn btn-danger btn-sm unlink-baking-recipe" data-recipe-id="${r.id}">הסר</button>
              </li>`).join('')}
          </ul>` : '<p class="form-hint baking-links-empty">אין מתכונים משויכים</p>'}
        <div class="baking-links-add" id="baking-add-recipe-block">
          <label class="baking-links-add-label">הוסף מתכון</label>
          <div class="filter-row">
            <select id="baking-link-recipe-pick" style="flex:1">${recipeOptions}</select>
            <button type="button" class="btn btn-primary btn-sm" id="baking-link-recipe-btn">+</button>
          </div>
          <p class="form-hint">שיוך מסמן את המתכון כ«כולל אפייה» עם פרופיל זה</p>
        </div>
      </div>`,
    footerHTML: '<button class="btn btn-secondary modal-cancel">סגור</button>',
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', () => {
    closeModal();
    renderRecipesBaking(container, { layout, productCatalog });
  });

  const getSelectedScopeType = () => document.querySelector('input[name="baking-scope-type"]:checked')?.value || 'group';

  const refreshScopeAddRow = () => {
    const row = document.getElementById('baking-scope-add-row');
    if (!row) return;
    row.innerHTML = buildBakingScopeAddRowHTML(getSelectedScopeType(), productCatalog, {
      linkedGroupIds, linkedCategoryIds, linkedProductIds, defaultProductCat,
    });
    bindScopeAddControls();
  };

  const bindScopeAddControls = () => {
    document.getElementById('baking-link-product-cat')?.addEventListener('change', () => {
      const catId = document.getElementById('baking-link-product-cat')?.value;
      const pick = document.getElementById('baking-link-product-pick');
      if (pick) pick.innerHTML = buildProductsSelectForCategory(productCatalog, catId, linkedProductIds);
    });

    document.getElementById('baking-link-scope-btn')?.addEventListener('click', async () => {
      const scopeType = getSelectedScopeType();
      try {
        if (scopeType === 'product') {
          const productId = Number(document.getElementById('baking-link-product-pick')?.value);
          if (!productId) return showToast('בחר מוצר');
          await linkProductToBakingProfile(profileId, productId);
          showToast('מוצר שויך ✓');
        } else if (scopeType === 'category') {
          const categoryId = Number(document.getElementById('baking-link-scope-pick')?.value);
          if (!categoryId) return showToast('בחר קטגוריה');
          await linkBakingProfileScope(profileId, BAKING_SCOPE_CATEGORY, categoryId);
          showToast('קטגוריה שויכה ✓');
        } else {
          const groupId = Number(document.getElementById('baking-link-scope-pick')?.value);
          if (!groupId) return showToast('בחר קבוצה');
          await linkBakingProfileScope(profileId, BAKING_SCOPE_GROUP, groupId);
          showToast('קבוצה שויכה ✓');
        }
        closeModal();
        openBakingProfileLinksModal(container, profileId, { layout, productCatalog }, { focusAdd: true });
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  };

  document.querySelectorAll('input[name="baking-scope-type"]').forEach((radio) => {
    radio.addEventListener('change', refreshScopeAddRow);
  });
  bindScopeAddControls();

  document.getElementById('baking-link-recipe-btn')?.addEventListener('click', async () => {
    const recipeId = Number(document.getElementById('baking-link-recipe-pick')?.value);
    if (!recipeId) return showToast('בחר מתכון');
    try {
      await linkRecipeToBakingProfile(profileId, recipeId);
      closeModal();
      openBakingProfileLinksModal(container, profileId, { layout, productCatalog });
      showToast('מתכון שויך ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.querySelectorAll('.unlink-baking-product').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await unlinkProductFromBakingProfile(profileId, Number(btn.dataset.productId));
        closeModal();
        openBakingProfileLinksModal(container, profileId, { layout, productCatalog });
        showToast('הוסר ✓');
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.querySelectorAll('.unlink-baking-scope').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await unlinkBakingProfileScope(profileId, btn.dataset.scopeType, Number(btn.dataset.scopeId));
        closeModal();
        openBakingProfileLinksModal(container, profileId, { layout, productCatalog });
        showToast('הוסר ✓');
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.querySelectorAll('.unlink-baking-recipe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await unlinkRecipeFromBakingProfile(Number(btn.dataset.recipeId));
        closeModal();
        openBakingProfileLinksModal(container, profileId, { layout, productCatalog });
        showToast('הוסר ✓');
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  if (focusAdd) {
    document.getElementById('baking-add-scope-block')?.scrollIntoView({ block: 'nearest' });
  }
}

function openBakingProfileForm(container, { profile, layout, productCatalog }) {
  const isEdit = !!profile;
  openModal({
    title: isEdit ? 'עריכת פרופיל אפייה' : 'פרופיל אפייה חדש',
    bodyHTML: `
      <div class="form-group">
        <label>שם פרופיל</label>
        <input type="text" id="baking-profile-name" maxlength="60" placeholder="למשל: בצק חמאה — תנור גדול" value="${profile ? escapeHtml(profile.name) : ''}">
      </div>
      ${buildBakingParamsFieldsHTML(profile, { idPrefix: 'baking-profile' })}
      <div class="form-group">
        <label>הערות (אופציונלי)</label>
        <textarea id="baking-profile-notes" rows="2">${profile ? escapeHtml(profile.notes || '') : ''}</textarea>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-baking-profile">שמור</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  bindBakingParamsFormToggle('baking-profile');
  document.getElementById('save-baking-profile')?.addEventListener('click', async () => {
    const name = document.getElementById('baking-profile-name')?.value.trim();
    const notes = document.getElementById('baking-profile-notes')?.value || '';
    const data = { name, notes, ...readBakingParamsFromForm('baking-profile') };
    try {
      if (isEdit) await updateBakingProfile(profile.id, data);
      else await addBakingProfile(data);
      closeModal();
      showToast('נשמר ✓');
      renderRecipes(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function buildRecipeViewHTML(recipe, { categoryPath, linkedNames, productCategoryName, profileMap }) {
  const ingredients = recipe.ingredients || [];
  const weightSummaryHtml = renderRecipeWeightSummaryHTML(ingredients, recipe);
  const yieldLabel = recipe.yieldPortions && recipe.yieldPortions !== 1
    ? `${recipe.yieldPortions} מנות`
    : 'מתכון בסיס';

  return `
    <article class="recipe-sheet">
      <header class="recipe-sheet-header">
        ${categoryPath ? `<p class="recipe-sheet-breadcrumb">${escapeHtml(categoryPath)}</p>` : ''}
        <h1 class="recipe-sheet-title">${escapeHtml(recipe.name)}</h1>
        <div class="recipe-sheet-meta">
          <span class="recipe-meta-pill">${escapeHtml(yieldLabel)}</span>
          ${productCategoryName ? `<span class="recipe-meta-pill">🏷️ ${escapeHtml(productCategoryName)}</span>` : ''}
          ${linkedNames?.length ? `<span class="recipe-meta-pill recipe-meta-products">🔗 ${linkedNames.map((n) => escapeHtml(n)).join(' · ')}</span>` : ''}
        </div>
      </header>
      <section class="recipe-sheet-section" aria-label="חומרי גלם">
        <h2 class="recipe-sheet-section-title">חומרי גלם</h2>
        ${ingredients.length ? `
        <div class="recipe-sheet-table-wrap">
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
        </div>
        ${weightSummaryHtml}` : '<p class="recipe-sheet-empty">אין חומרי גלם — לחץ «עריכה» להוספה</p>'}
      </section>
      ${buildRecipeBakingViewHTML(recipe, profileMap)}
      ${recipe.notes?.trim() ? `
      <section class="recipe-sheet-section recipe-sheet-notes-block">
        <h2 class="recipe-sheet-section-title">הערות</h2>
        <p class="recipe-sheet-notes">${escapeHtml(recipe.notes.trim())}</p>
      </section>` : ''}
    </article>`;
}

async function openRecipeView(container, recipe, { productCatalog, layout }) {
  const [products, profiles] = await Promise.all([getProducts(true), getBakingProfiles()]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const linkedNames = (recipe.linkedProductIds || []).map((id) => productMap.get(id)?.name).filter(Boolean);
  const categoryPath = findRecipeCategoryPath(layout, recipe.categoryId);
  const productCategoryName = findProductCategoryName(productCatalog, recipe.linkedProductCategoryId);

  openModal({
    title: '',
    modalClass: 'modal-recipe-view',
    bodyHTML: buildRecipeViewHTML(recipe, { categoryPath, linkedNames, productCategoryName, profileMap }),
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">סגור</button>
      <button type="button" class="btn btn-secondary" id="recipe-view-ratio">⚖️ יחס</button>
      <button type="button" class="btn btn-primary" id="recipe-view-edit">✏️ עריכה</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('recipe-view-edit')?.addEventListener('click', () => {
    closeModal();
    openRecipeForm(container, { recipe, productCatalog, layout, returnToView: true });
  });
  document.getElementById('recipe-view-ratio')?.addEventListener('click', () => {
    sessionStorage.setItem(RATIO_RECIPE_KEY, String(recipe.id));
    closeModal();
    switchRecipeTab('ratio');
  });
}

function openRatioCalculatorPicker(layout) {
  const options = buildRecipeSelectOptions(layout);
  if (!options) return showToast('אין מתכונים');
  openModal({
    title: 'מחשבון יחס',
    bodyHTML: `
      <div class="form-group">
        <label>בחר מתכון</label>
        <select id="ratio-recipe-pick">${options}</select>
      </div>
      <div id="ratio-calculator-host"></div>`,
    footerHTML: '<button class="btn btn-primary modal-cancel">סגור</button>',
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  const host = document.getElementById('ratio-calculator-host');
  const pick = document.getElementById('ratio-recipe-pick');
  const loadRecipe = async () => {
    const recipe = await getRecipe(Number(pick?.value));
    if (!recipe || !host) return;
    bindRatioCalculator(recipe, host);
  };
  pick?.addEventListener('change', loadRecipe);
  loadRecipe();
}

function bindMaterialSearch(mats, input, hidden, list) {
  if (!input || !hidden || !list) return;

  const renderList = (filter = '') => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? mats.filter((m) => m.name.toLowerCase().includes(q))
      : mats.slice(0, 50);
    list.innerHTML = filtered.map((m) => `
      <li><button type="button" class="mat-search-option" data-id="${m.id}">${escapeHtml(m.name)}</button></li>`).join('');
    list.classList.toggle('hidden', filtered.length === 0);
  };

  input.addEventListener('input', () => {
    hidden.value = '';
    renderList(input.value);
  });
  input.addEventListener('focus', () => renderList(input.value));
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.mat-search-option');
    if (!btn) return;
    hidden.value = btn.dataset.id;
    input.value = mats.find((m) => m.id === Number(btn.dataset.id))?.name || '';
    list.classList.add('hidden');
  });
  input.addEventListener('blur', () => {
    setTimeout(() => list.classList.add('hidden'), 150);
  });
}

function bindMaterialSearchPicker(mats) {
  bindMaterialSearch(
    mats,
    document.getElementById('new-ing-mat-search'),
    document.getElementById('new-ing-mat'),
    document.getElementById('new-ing-mat-list'),
  );
}

async function openRecipeForm(container, { recipe, categoryId, productCatalog, layout, returnToView }) {
  const isEdit = !!recipe;
  const ingredients = recipe?.ingredients || [];
  const [mats, bakingProfiles, suppliers] = await Promise.all([
    getRawMaterials(), getBakingProfiles(), getSuppliers(),
  ]);
  const matCtx = buildRecipeMaterialContext(mats, suppliers);
  const catalog = productCatalog || await getProductsCatalogLayout();
  const catalogLayout = layout || container._recipeLayout;
  const selectedCategoryId = recipe?.categoryId || categoryId || '';
  const categoryOptions = catalogLayout
    ? buildCategorySelectOptions(catalogLayout.groups, selectedCategoryId)
    : '';

  openModal({
    title: isEdit ? 'עריכת מתכון' : 'מתכון חדש',
    modalClass: isEdit ? 'modal-recipe-edit' : '',
    bodyHTML: `
      <div class="form-group">
        <label>שם מתכון</label>
        <input type="text" id="recipe-name" value="${recipe ? escapeHtml(recipe.name) : ''}">
      </div>
      ${categoryOptions ? `
      <div class="form-group">
        <label>קטגוריית מתכון</label>
        <select id="recipe-category">${categoryOptions}</select>
      </div>` : ''}
      <div class="form-group">
        <label>מנות למתכון (בסיס)</label>
        <input type="number" id="recipe-yield" min="0.1" step="0.1" value="${recipe?.yieldPortions ?? 1}">
      </div>
      <label class="group-category-option" style="margin-bottom:12px">
        <input type="checkbox" id="recipe-show-portions" ${recipe?.showTotalAsPortions ? 'checked' : ''}>
        <span>הצג סה״כ במנות</span>
      </label>
      <div class="form-group">
        <label for="recipe-portion-weight">משקל מוצר יחידה (גרם)</label>
        <input type="number" id="recipe-portion-weight" min="1" step="1" placeholder="למשל: 85 — משקל יחידת מוצר סופית" value="${recipe?.portionWeightGrams ?? ''}">
        <p class="form-hint">הזן משקל יחידה — יוצג כמה מוצרים יוצאים ממנה אחת של המתכון</p>
      </div>
      <div class="form-group recipe-product-link-block">
        ${buildOptionalProductLinkerHTML(catalog, {
    linkedProductCategoryId: recipe?.linkedProductCategoryId,
    linkedProductIds: recipe?.linkedProductIds,
  })}
      </div>
      <div class="form-group">
        <label>הערות</label>
        <textarea id="recipe-notes" rows="2">${recipe ? escapeHtml(recipe.notes || '') : ''}</textarea>
      </div>
      ${buildRecipeBakingFormHTML(recipe, bakingProfiles)}
      ${isEdit ? `
      <div class="form-group">
        <label>חומרי גלם</label>
        ${ingredients.length ? ingredients.map((ing) => renderRecipeIngredientRowHTML(ing, matCtx)).join('') : '<p class="form-hint">אין חומרים</p>'}
        ${ingredients.length ? `<div id="recipe-ing-total" class="recipe-ingredients-total">${renderRecipeCostAndWeightHTML(ingredients, recipe, matCtx)}</div>` : ''}
        <div class="filter-row" style="margin-top:8px">
          <div class="mat-search-wrap" style="flex:1;position:relative">
            <input type="text" id="new-ing-mat-search" placeholder="חפש חומר גלם..." autocomplete="off">
            <input type="hidden" id="new-ing-mat" value="">
            <ul class="mat-search-list hidden" id="new-ing-mat-list"></ul>
          </div>
          <input type="text" id="new-ing-name" placeholder="שם ידני" style="flex:1">
          <input type="number" id="new-ing-qty" min="0.001" step="0.001" placeholder="כמות" style="width:72px">
          <select id="new-ing-unit" style="width:72px">
            ${RECIPE_WEIGHT_UNITS.map((u) => `<option value="${u.id}">${u.label}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" id="add-ing-btn">+</button>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="sync-product-cost" style="width:100%;margin-top:8px">
          🔄 עדכן מחיר חומרי גלם במוצרים המקושרים (אוטומטי בשמירה)
        </button>
      </div>` : ''}`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-recipe">שמור</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  bindOptionalProductLinker(catalog, {
    linkedProductCategoryId: recipe?.linkedProductCategoryId,
    linkedProductIds: recipe?.linkedProductIds,
  });

  bindRecipeBakingFormToggle(bakingProfiles);

  if (isEdit) bindMaterialSearchPicker(mats);

  document.querySelectorAll('.recipe-ing-row').forEach((row) => {
    const ingId = Number(row.dataset.ingId);
    row.querySelector('.ing-qty')?.addEventListener('change', async (e) => {
      try { await updateRecipeIngredient(ingId, { quantity: e.target.value }); }
      catch (err) { showToast(err.message || 'שגיאה'); }
      refreshRecipeTotalDisplay(ingredients, recipe, matCtx);
    });
    row.querySelector('.ing-qty')?.addEventListener('input', () => refreshRecipeTotalDisplay(ingredients, recipe, matCtx));
    row.querySelector('.ing-unit')?.addEventListener('change', async (e) => {
      try { await updateRecipeIngredient(ingId, { unitKind: e.target.value }); }
      catch (err) { showToast(err.message || 'שגיאה'); }
      refreshRecipeTotalDisplay(ingredients, recipe, matCtx);
    });
  });

  document.querySelectorAll('.pick-ing-supplier').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ing = ingredients.find((i) => i.id === Number(btn.dataset.ingId));
      if (ing) {
        openIngredientSupplierPicker(container, recipe, ing, matCtx, mats, catalog, catalogLayout, returnToView);
      }
    });
  });

  document.getElementById('recipe-yield')?.addEventListener('input', () => {
    if (isEdit) refreshRecipeTotalDisplay(ingredients, recipe, matCtx);
  });
  document.getElementById('recipe-portion-weight')?.addEventListener('input', () => {
    if (isEdit) refreshRecipeTotalDisplay(ingredients, recipe, matCtx);
  });
  document.getElementById('recipe-show-portions')?.addEventListener('change', () => {
    if (isEdit) refreshRecipeTotalDisplay(ingredients, recipe, matCtx);
  });

  document.getElementById('add-ing-btn')?.addEventListener('click', async () => {
    const matId = Number(document.getElementById('new-ing-mat')?.value);
    const searchName = document.getElementById('new-ing-mat-search')?.value.trim();
    const manualName = document.getElementById('new-ing-name')?.value.trim();
    const qty = document.getElementById('new-ing-qty')?.value;
    const unitKind = document.getElementById('new-ing-unit')?.value || 'kg';
    let mat = mats.find((m) => m.id === matId);
    if (!mat && searchName) {
      mat = mats.find((m) => m.name === searchName)
        || mats.find((m) => m.name.toLowerCase() === searchName.toLowerCase());
    }
    const name = mat?.name || manualName;
    if (!name || !qty) return showToast('הזן שם וכמות');
    try {
      await addRecipeIngredient(recipe.id, {
        rawMaterialId: null,
        name,
        quantity: qty,
        unitKind,
        priceSource: 'max',
      });
      closeModal();
      openRecipeForm(container, {
        recipe: await getRecipe(recipe.id), productCatalog: catalog, layout: catalogLayout, returnToView,
      });
      showToast('נוסף ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.querySelectorAll('.del-ing').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteRecipeIngredient(Number(btn.dataset.id));
      closeModal();
      openRecipeForm(container, {
        recipe: await getRecipe(recipe.id), productCatalog: catalog, layout: catalogLayout, returnToView,
      });
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
    const linkedProductCategoryId = document.getElementById('recipe-product-category')?.value || null;
    const recipeCategoryId = Number(document.getElementById('recipe-category')?.value) || categoryId;
    const portionRaw = document.getElementById('recipe-portion-weight')?.value?.trim();
    const data = {
      name: document.getElementById('recipe-name').value.trim(),
      yieldPortions: document.getElementById('recipe-yield').value,
      showTotalAsPortions: document.getElementById('recipe-show-portions')?.checked || false,
      portionWeightGrams: portionRaw || null,
      linkedProductIds,
      linkedProductCategoryId: linkedProductCategoryId || null,
      notes: document.getElementById('recipe-notes').value,
      ...readBakingFromForm(),
    };
    try {
      if (isEdit) {
        if (recipeCategoryId) data.categoryId = recipeCategoryId;
        await updateRecipe(recipe.id, data);
        try {
          await syncProductCostFromRecipe(recipe.id);
        } catch {
          /* no linked products */
        }
        closeModal();
        showToast('נשמר ✓');
        if (returnToView) {
          const updated = await getRecipe(recipe.id);
          openRecipeView(container, updated, { productCatalog: catalog, layout: catalogLayout });
        } else {
          renderRecipes(container);
        }
      } else {
        await addRecipe({ ...data, categoryId: recipeCategoryId });
        closeModal();
        if (recipeCategoryId) expandRecipeCategory(recipeCategoryId);
        showToast('נשמר ✓');
        renderRecipes(container);
      }
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}
