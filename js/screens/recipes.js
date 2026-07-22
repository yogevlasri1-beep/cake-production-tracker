import {
  getRecipeGroups, getRecipeSubCategories, getRecipes, getRecipe, getRecipesCatalogLayout,
  addRecipeGroup, addRecipeSubCategory, updateRecipeGroup, updateRecipeSubCategory,
  deleteRecipeGroup, deleteRecipeSubCategory, ensureRecipeTypeCatalog,
  addRecipe, updateRecipe, deleteRecipe, deleteAllRecipes, addRecipeIngredient, deleteRecipeIngredient,
  addSubRecipe, getRecipeSubRecipes,
  updateRecipeIngredient, syncProductCostFromRecipe, getRawMaterials, getSuppliers,
  setRecipeOrder, setRecipeGroupOrder, setRecipeSubCategoryOrder, moveRecipesToCategory,
  importParsedRecipes, scaleRecipeIngredients,
  findOrCreateWordImportCategory, IMPORT_WORD_GROUP, IMPORT_WORD_SUB,
  getExistingRecipeNameKeys, normalizeRecipeImportKey, formatRecipeIngredientsTotal,
  formatRecipeQuantity,
  getRecipeWeightSummary, formatKgWeight,
  formatSubdivisionWeight, gramsFromSubdivisionKg,
  computeRecipeProductUnits,
  getRecipeProductYieldInfo, scaleRecipeIngredientsForProductCount,
  scaleIngredientsToTargetGrams, recipeTotalWeightGrams,
  RECIPE_WEIGHT_UNITS, normalizeRecipeUnitKind, RECIPE_SORT_GROUP_DEFAULT,
  RECIPE_OVEN_TYPES, normalizeRecipeBakingFields, resolveRecipeBaking,
  getRecipeOvenLabel,
  formatBakingProfileOvensSummary, formatOvenBakeParamsLine, getEnabledBakingOvens,
  getBakingProfiles, getBakingProfile, addBakingProfile, updateBakingProfile, deleteBakingProfile,
  getProductsForBakingProfile, getRecipesForBakingProfile, getBakingProfileScopes,
  linkProductToBakingProfile, unlinkProductFromBakingProfile,
  linkBakingProfileScope, unlinkBakingProfileScope,
  linkRecipeToBakingProfile, unlinkRecipeFromBakingProfile,
  countRecipesUsingBakingProfile, buildProductBakingIndex,
  BAKING_SCOPE_GROUP, BAKING_SCOPE_CATEGORY,
  buildMaterialsByNameKey, resolveRecipeIngredientMaterial, computeIngredientLineCost,
  computeRecipeMaterialsCost, getIngredientPriceSource, getMaterialsByIngredientName,
  computePricePerKg, pickHighestPricedMaterial, pickRecipeDefaultMaterial,
  materialMatchesSearch, getMaterialSynonyms, getMaterialEffectivePricePerKg,
} from '../kitchen-db.js?v=346';
import { getProducts, getProductsCatalogLayout } from '../db.js?v=346';
import { parseRecipesFromDocxFile, buildRecipeBookHtml, renderRecipeBookItemHTML } from '../recipe-import.js?v=346';
import { renderRecipesMachines } from '../recipes-machines.js?v=346';
import { renderRecipesPortions } from '../recipes-portions.js?v=346';
import { buildRatioPrintHtml, printRatioHtml } from '../ratio-print.js?v=346';
import { buildBakingPrintHtml, shareBakingHtml } from '../baking-print.js?v=346';
import { escapeHtml, showToast, formatMoney } from '../utils.js?v=346';
import { openModal, closeModal } from '../modal.js?v=346';
import {
  bindRecipeDragLists, bindCategoryDragList, bindCategoryGroupDragList,
} from '../product-drag.js?v=346';
import { defaultColorForIndex } from '../chart.js?v=346';

const EXPANDED_RECIPE_GROUPS_KEY = 'yitzurExpandedRecipeGroups';
const EXPANDED_RECIPE_CATS_KEY = 'yitzurExpandedRecipeCategories';
const RECIPE_TAB_KEY = 'yitzurRecipeTab';
const RECIPE_SEARCH_KEY = 'yitzurRecipeSearch';
const RECIPE_EDIT_SEARCH_KEY = 'yitzurRecipeEditSearch';
const RATIO_RECIPE_KEY = 'yitzurRatioRecipeId';
const RATIO_CAT_KEY = 'yitzurRatioRecipeCatId';
const BAKING_VIEW_KEY = 'yitzurBakingViewMode';

export const RECIPE_TABS = {
  browse: { id: 'browse', label: 'מתכונים', subtitle: 'צפייה, חיפוש וספר מתכונים' },
  edit: { id: 'edit', label: 'עריכה ובנייה', subtitle: 'הוספה, ייבוא Word וניהול קטגוריות' },
  baking: { id: 'baking', label: 'אפיות', subtitle: 'פרופילי אפייה ושיוך למתכונים' },
  ratio: { id: 'ratio', label: 'מחשבון יחס', subtitle: 'המרת כמויות לפי חומר בסיס' },
  machines: { id: 'machines', label: 'מכונות', subtitle: 'מכונות יצור, פרמטרים ושיוך מוצרים' },
  portions: { id: 'portions', label: 'מנות', subtitle: 'סדר ושיוך מנות לייצור' },
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

function recipeListMetaText(r) {
  let meta = 'מנה אחת';
  if (r.portionWeightGrams) {
    meta += ` · חלוקה: ${formatSubdivisionWeight(r.portionWeightGrams)}`;
  }
  if (String(r.notes || '').trim()) {
    meta += ' · 📝 הערות';
  }
  return meta;
}

function recipeNotesFieldHTML(notes = '') {
  return `
      <div class="form-group recipe-notes-form-group">
        <label for="recipe-notes">הערות / דרך הכנה <span class="field-optional">(אופציונלי)</span></label>
        <textarea id="recipe-notes" class="recipe-notes-input" rows="6" maxlength="4000" placeholder="למשל: ללוש 8 דק׳, להניח לנוח במשך שעה, לאפות ב-180° עד זהב…">${escapeHtml(notes || '')}</textarea>
        <p class="form-hint">טקסט חופשי למתכון — לא חובה. נשמר עם המתכון ומופיע בתצוגה ובספר המתכונים.</p>
      </div>`;
}

function renderSubRecipeItem(r, index, mode = 'edit') {
  const browseClass = mode === 'browse' ? ' recipe-row-browse' : '';
  if (mode === 'browse') {
    return `
    <div class="list-item recipe-list-item recipe-sub-recipe-item recipe-row-open${browseClass}" data-recipe-id="${r.id}" role="button" tabindex="0">
      <div class="list-item-info">
        <div class="list-item-name"><span class="recipe-sub-badge">תת מתכון</span> ${escapeHtml(r.name)}</div>
        <div class="list-item-meta">${recipeListMetaText(r)}</div>
      </div>
      <span class="recipe-browse-chevron" aria-hidden="true">‹</span>
    </div>`;
  }
  return `
    <div class="list-item recipe-list-item recipe-sub-recipe-item recipe-row-open" data-recipe-id="${r.id}" role="button" tabindex="0">
      <div class="list-item-info">
        <div class="list-item-name"><span class="recipe-sub-badge">תת מתכון</span> ${escapeHtml(r.name)}</div>
        <div class="list-item-meta">${recipeListMetaText(r)}</div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn btn-danger btn-sm delete-recipe" data-id="${r.id}">🗑</button>
      </div>
    </div>`;
}

function renderRecipeItem(r, index, mode = 'edit') {
  const subs = (r.subRecipes || []).map((sub, si) => renderSubRecipeItem(sub, si, mode)).join('');
  if (mode === 'browse') {
    return `
    <div class="recipe-parent-block">
    <div class="list-item recipe-list-item recipe-row-open recipe-row-browse" data-recipe-id="${r.id}" role="button" tabindex="0">
      <div class="list-item-info">
        <div class="list-item-name">${escapeHtml(r.name)}</div>
        <div class="list-item-meta">${recipeListMetaText(r)}</div>
      </div>
      <span class="recipe-browse-chevron" aria-hidden="true">‹</span>
    </div>
    ${subs}
    </div>`;
  }
  const checked = selectedRecipeIds.has(r.id) ? 'checked' : '';
  return `
    <div class="recipe-parent-block">
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
        <div class="list-item-meta">${recipeListMetaText(r)}</div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn btn-secondary btn-sm add-sub-recipe" data-id="${r.id}" title="הוסף תת מתכון">+ תת</button>
        <button type="button" class="btn btn-danger btn-sm delete-recipe" data-id="${r.id}">🗑</button>
      </div>
    </div>
    ${subs}
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
      if (e.target.closest('.recipe-drag-handle, .delete-recipe, .recipe-select-wrap, .add-sub-recipe')) return;
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
    return renderRecipeBook(container, { groups: layout.groups, allSubs: layout.allSubCategories, productMap, productCatalog });
  }

  if (tab === 'browse') return renderRecipesBrowse(container, { layout, productCatalog });
  if (tab === 'edit') return renderRecipesEdit(container, { layout, productCatalog });
  if (tab === 'baking') return renderRecipesBaking(container, { layout, productCatalog });
  if (tab === 'machines') return renderRecipesMachines(container, { productCatalog });
  if (tab === 'portions') return renderRecipesPortions(container, { productCatalog });
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
        <button type="button" class="btn-new-recipe" id="new-recipe-btn" title="מתכון חדש" aria-label="מתכון חדש">
          <span class="btn-new-recipe-icon" aria-hidden="true">📒</span>
          <span class="btn-new-recipe-plus" aria-hidden="true">+</span>
        </button>
        <label class="btn btn-secondary btn-sm backup-file-label" for="recipe-word-file">📄 Word
          <input type="file" id="recipe-word-file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
        </label>
        <button type="button" class="btn btn-secondary btn-sm" id="manage-recipe-cats">⚙️</button>
      </div>
      <p class="form-hint" style="margin:0">לחץ על כפתור המתכון ליצירת מתכון חדש — עם שיוך לקטגוריה ולמוצר.</p>
    </div>
    <div class="recipe-browse-toolbar">
      <input type="search" class="recipe-browse-search" id="recipe-edit-search" placeholder="חיפוש מתכון..." value="${escapeHtml(savedSearch)}" autocomplete="off">
    </div>
    <div class="section-header products-toolbar">
      <h2>קטגוריות ומתכונים</h2>
      <div class="products-toolbar-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="add-recipe-group-btn">+ קבוצת סידור</button>
        <button type="button" class="btn btn-secondary btn-sm" id="add-recipe-sub-btn">+ קטגוריה</button>
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

  const openNewRecipe = () => openNewRecipeBuilder(container, { layout, productCatalog });
  document.getElementById('new-recipe-btn')?.addEventListener('click', openNewRecipe);

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
      openNewRecipeBuilder(container, {
        layout,
        productCatalog,
        categoryId: Number(btn.dataset.cat),
      });
    });
  });

  container.querySelectorAll('.add-sub-recipe').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const parentId = Number(btn.dataset.id);
      const parent = await getRecipe(parentId);
      if (!parent) return;
      const name = prompt('שם תת המתכון (תוספת למוצר):', `${parent.name} — תוספת`);
      if (name === null) return;
      try {
        const subId = await addSubRecipe(parentId, { name: name.trim() });
        const sub = await getRecipe(subId);
        showToast('תת מתכון נוצר ✓');
        openRecipeForm(container, { recipe: sub, productCatalog, layout, returnToView: true });
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
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
      <p class="form-hint" style="margin-bottom:12px">סמן חומר גלם, הזן כמות יעד — או משקל יחידה ומספר יחידות. החישוב מסתנכרן בין השדות.</p>
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

function bakingSourceLabel(source) {
  if (source === 'product') return 'שיוך מוצר';
  if (source === 'category') return 'שיוך קטגוריה';
  if (source === 'group') return 'מירושת קבוצה';
  return '';
}

function pushOvenItems(base, profile, ovens, target) {
  for (const oven of ovens) {
    target.push({
      ...base,
      profile,
      profileId: profile.id,
      ovenType: oven.ovenType,
      ovenLabel: oven.label,
      baking: {
        hasBaking: true,
        bakeTempC: oven.bakeTempC,
        bakeTimeMinutes: oven.bakeTimeMinutes,
        bakeSteamSeconds: oven.bakeSteamSeconds,
        bakeDryMinutes: oven.bakeDryMinutes,
        bakeOvenType: oven.ovenType,
        profileName: profile.name,
      },
    });
  }
}

/** Categories with a baking profile (category scope or inherited group scope), catalog order. */
function collectBakingCategoryItems(productCatalog, bakingIndex) {
  const items = [];
  const walk = (categories, groupName, groupId) => {
    for (const cat of categories || []) {
      let resolved = bakingIndex.byCategoryId?.get(Number(cat.id));
      if (!resolved && groupId) {
        resolved = bakingIndex.byGroupId?.get(Number(groupId));
      }
      if (!resolved?.profile) continue;
      const ovens = getEnabledBakingOvens(resolved.profile);
      if (!ovens.length) continue;
      const categoryPath = groupName ? `${groupName} › ${cat.name}` : cat.name;
      pushOvenItems({
        rowType: 'category',
        categoryId: cat.id,
        categoryName: cat.name,
        categoryPath,
        groupId: groupId || null,
        groupName: groupName || '',
        productId: null,
        productName: cat.name,
        source: resolved.source,
        scopeName: resolved.scopeName,
      }, resolved.profile, ovens, items);
    }
  };
  for (const group of productCatalog?.groups || []) {
    walk(group.categories, group.name, group.id);
  }
  walk(productCatalog?.ungrouped || [], '', null);
  return items;
}

/** Products with baking, catalog order (groups → categories → products). */
function collectBakingProductItems(productCatalog, bakingIndex) {
  const items = [];
  const walk = (categories, groupName) => {
    for (const cat of categories || []) {
      const categoryPath = groupName ? `${groupName} › ${cat.name}` : cat.name;
      for (const product of cat.products || []) {
        if (product.active === false) continue;
        const resolved = bakingIndex.byProductId.get(Number(product.id));
        if (!resolved) continue;
        const profile = resolved.profile;
        const ovens = getEnabledBakingOvens(profile);
        if (!ovens.length) continue;
        pushOvenItems({
          rowType: 'product',
          product,
          productId: product.id,
          productName: product.name,
          categoryPath,
          categoryId: cat.id,
          groupName: groupName || '',
          source: resolved.source,
          scopeName: resolved.scopeName,
        }, profile, ovens, items);
      }
    }
  };
  for (const group of productCatalog?.groups || []) {
    walk(group.categories, group.name);
  }
  walk(productCatalog?.ungrouped || [], '');
  return items;
}

function splitBakingItemsByOven(items) {
  return {
    large: items.filter((i) => i.ovenType === 'large'),
    small: items.filter((i) => i.ovenType === 'small'),
  };
}

function getBakingViewMode(container) {
  return container?.dataset?.bakingViewMode
    || sessionStorage.getItem(BAKING_VIEW_KEY)
    || 'category';
}

function setBakingViewMode(container, mode) {
  sessionStorage.setItem(BAKING_VIEW_KEY, mode);
  if (container) container.dataset.bakingViewMode = mode;
}

/** Group items by catalog group, preserving insertion (catalog) order. */
function groupBakingItemsByCatalogGroup(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.groupName || item.categoryPath?.split(' › ')[0] || 'ללא קבוצה';
    if (!map.has(key)) map.set(key, { key, label: key, items: [] });
    map.get(key).items.push(item);
  }
  return [...map.values()];
}

/** Group product items by category path, preserving catalog order. */
function groupBakingProductsByCategoryOrder(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.categoryPath || 'אחר';
    if (!map.has(key)) map.set(key, { key, label: key, items: [] });
    map.get(key).items.push(item);
  }
  return [...map.values()];
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
  const ovens = getEnabledBakingOvens(profile);
  const ovenMeta = ovens.length
    ? ovens.map((o) => `${o.label}: ${formatOvenBakeParamsLine(o)}`).join(' · ')
    : '—';
  const scopeParts = [];
  if (scopeCounts.groups) scopeParts.push(`${scopeCounts.groups} קבוצות`);
  if (scopeCounts.categories) scopeParts.push(`${scopeCounts.categories} קטגוריות`);
  const scopeMeta = scopeParts.length ? `${scopeParts.join(' · ')} · ` : '';
  return `
    <div class="baking-profile-row baking-profile-row--clickable" data-profile-id="${profile.id}" role="button" tabindex="0">
      <div class="baking-profile-row-main">
        <strong class="baking-profile-name">${escapeHtml(profile.name)}</strong>
        <span class="baking-profile-meta">${escapeHtml(ovenMeta)}</span>
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

function renderBakingListGroupCard(group, viewMode = 'category') {
  const isCategory = viewMode === 'category';
  const nameHeader = isCategory ? 'קטגוריה' : 'מוצר';
  const countLabel = isCategory
    ? `${group.items.length} קטגוריות`
    : `${group.items.length} מוצרים`;
  return `
    <div class="card baking-profile-group-card" data-baking-group-key="${escapeHtml(group.key)}">
      <div class="baking-oven-group-header">
        <div>
          <h3 class="baking-oven-group-title">${isCategory ? '📂' : '📦'} ${escapeHtml(group.label)}</h3>
        </div>
        <span class="baking-oven-group-count">${countLabel}</span>
      </div>
      <div class="baking-table-wrap">
        <table class="baking-table">
          <thead>
            <tr>
              <th scope="col" class="baking-col-name">${nameHeader}</th>
              <th scope="col" class="baking-col-param">טמפ׳</th>
              <th scope="col" class="baking-col-param">זמן</th>
              <th scope="col" class="baking-col-param">קיטור</th>
              <th scope="col" class="baking-col-param">יבוש</th>
            </tr>
          </thead>
          <tbody>
            ${group.items.map((item) => {
    const source = bakingSourceLabel(item.source);
    if (isCategory) {
      const secondary = [item.baking.profileName, source].filter(Boolean).join(' · ');
      return `
            <tr class="baking-row baking-category-row" data-profile-id="${item.profileId}" data-category-id="${item.categoryId}" role="button" tabindex="0">
              <td class="baking-col-name">
                <strong class="baking-recipe-name">${escapeHtml(item.categoryName || item.productName)}</strong>
                <span class="baking-recipe-path">${escapeHtml(secondary)}</span>
              </td>
              ${renderBakingParamsCells(item.baking)}
            </tr>`;
    }
    const secondary = [item.categoryPath, item.baking.profileName, source].filter(Boolean).join(' · ');
    return `
            <tr class="baking-row baking-product-row" data-profile-id="${item.profileId}" data-product-id="${item.productId}" role="button" tabindex="0">
              <td class="baking-col-name">
                <strong class="baking-recipe-name">${escapeHtml(item.productName)}</strong>
                <span class="baking-recipe-path">${escapeHtml(secondary)}</span>
              </td>
              ${renderBakingParamsCells(item.baking)}
            </tr>`;
  }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderBakingOvenSection(ovenType, label, items, viewMode) {
  const isCategory = viewMode === 'category';
  const unit = isCategory ? 'קטגוריות' : 'מוצרים';
  if (!items.length) {
    return `
    <section class="baking-oven-section baking-oven-section--${ovenType} baking-oven-section--empty">
      <div class="baking-oven-section-header">
        <h2 class="baking-oven-section-title">${escapeHtml(label)}</h2>
        <span class="baking-oven-section-count">0 ${unit}</span>
      </div>
      <p class="form-hint baking-oven-section-empty">${isCategory ? 'אין קטגוריות עם פרופיל אפייה לתנור זה' : 'אין מוצרים משויכים לתנור זה'}</p>
    </section>`;
  }
  const groups = isCategory
    ? groupBakingItemsByCatalogGroup(items)
    : groupBakingProductsByCategoryOrder(items);
  return `
    <section class="baking-oven-section baking-oven-section--${ovenType}">
      <div class="baking-oven-section-header">
        <h2 class="baking-oven-section-title">${escapeHtml(label)}</h2>
        <span class="baking-oven-section-count">${items.length} ${unit}</span>
      </div>
      ${groups.map((g) => renderBakingListGroupCard(g, viewMode)).join('')}
    </section>`;
}

function openBakingShareChooser(productCatalog, { defaultMode = 'category' } = {}) {
  openModal({
    title: 'שיתוף אפיות',
    bodyHTML: `
      <p class="form-hint" style="margin-top:0">בחרו סוג רשימה · ייפתח Share (אפשר לשלוח או להדפיס) · תנור גדול ותנור קטן בעמודים נפרדים</p>
      <div class="form-group">
        <label>סוג רשימה</label>
        <div class="baking-scope-type-row" role="radiogroup" aria-label="סוג שיתוף">
          <label class="baking-scope-type-option">
            <input type="radio" name="baking-print-mode" value="category"${defaultMode === 'category' ? ' checked' : ''}>
            לפי קטגוריות
          </label>
          <label class="baking-scope-type-option">
            <input type="radio" name="baking-print-mode" value="product"${defaultMode === 'product' ? ' checked' : ''}>
            מפורט למוצרים
          </label>
        </div>
      </div>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="baking-share-confirm">📤 שתף</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('baking-share-confirm')?.addEventListener('click', async () => {
    const mode = document.querySelector('input[name="baking-print-mode"]:checked')?.value || 'category';
    closeModal();
    try {
      const bakingIndex = await buildProductBakingIndex();
      const allItems = mode === 'category'
        ? collectBakingCategoryItems(productCatalog, bakingIndex)
        : collectBakingProductItems(productCatalog, bakingIndex);
      const byOven = splitBakingItemsByOven(allItems);
      if (!byOven.large.length && !byOven.small.length) {
        showToast(mode === 'category' ? 'אין קטגוריות לשיתוף' : 'אין מוצרים לשיתוף');
        return;
      }
      const printedAt = new Date().toLocaleString('he-IL');
      const html = buildBakingPrintHtml({
        viewMode: mode,
        largeItems: byOven.large,
        smallItems: byOven.small,
        printedAt,
      });
      const method = await shareBakingHtml(html, { viewMode: mode });
      if (method === 'cancelled') return;
      if (method === 'share') showToast('נפתח Share — אפשר לשלוח או להדפיס');
      else showToast('הקובץ הורד');
    } catch (err) {
      showToast(err.message || 'שגיאה בשיתוף');
    }
  });
}

async function loadFreshBakingContext() {
  const [layout, productCatalog] = await Promise.all([
    getRecipesCatalogLayout(),
    getProductsCatalogLayout(),
  ]);
  return { layout, productCatalog };
}

async function reloadBakingTab(container) {
  await renderRecipes(container);
}

async function renderRecipesBaking(container, { layout, productCatalog }) {
  const viewMode = getBakingViewMode(container);
  setBakingViewMode(container, viewMode);
  const [profiles, bakingIndex] = await Promise.all([
    getBakingProfiles(),
    buildProductBakingIndex(),
  ]);
  const allItems = viewMode === 'category'
    ? collectBakingCategoryItems(productCatalog, bakingIndex)
    : collectBakingProductItems(productCatalog, bakingIndex);
  const byOven = splitBakingItemsByOven(allItems);

  const recipeCounts = new Map();
  const scopeCounts = new Map();
  await Promise.all(profiles.map(async (profile) => {
    recipeCounts.set(profile.id, await countRecipesUsingBakingProfile(profile.id));
    const scopes = await getBakingProfileScopes(profile.id);
    scopeCounts.set(profile.id, { groups: scopes.groups.length, categories: scopes.categories.length });
  }));

  const profileCatalog = profiles.length
    ? profiles.map((p) => renderBakingProfileCatalogRow(
      p,
      bakingIndex.countByProfileId.get(Number(p.id)) || 0,
      recipeCounts.get(p.id) || 0,
      scopeCounts.get(p.id) || {},
    )).join('')
    : '<p class="form-hint baking-profile-empty">אין פרופילי אפייה — צור פרופיל ראשון</p>';

  const countLabel = viewMode === 'category'
    ? `${allItems.length} קטגוריות`
    : `${allItems.length} מוצרים`;
  const hasList = allItems.length > 0 || profiles.length > 0;
  const listHTML = hasList ? `
    <div class="section-header baking-recipes-header">
      <div class="baking-recipes-header-main">
        <h2>${viewMode === 'product' ? 'אפיות — מפורט למוצרים' : 'אפיות לפי קטגוריות'}</h2>
        <span class="baking-total-count">${countLabel}</span>
      </div>
      <div class="flow-scope-tabs baking-view-tabs">
        <button type="button" class="flow-scope-tab baking-view-tab${viewMode === 'category' ? ' active' : ''}" data-baking-view="category">לפי קטגוריות</button>
        <button type="button" class="flow-scope-tab baking-view-tab${viewMode === 'product' ? ' active' : ''}" data-baking-view="product">מפורט למוצרים</button>
      </div>
    </div>
    ${renderBakingOvenSection('large', RECIPE_OVEN_TYPES.large, byOven.large, viewMode)}
    <div class="baking-oven-divider" aria-hidden="true"></div>
    ${renderBakingOvenSection('small', RECIPE_OVEN_TYPES.small, byOven.small, viewMode)}`
    : `
    <div class="empty-state">
      <div class="empty-state-icon">🔥</div>
      <p>${viewMode === 'category' ? 'אין קטגוריות עם פרופיל אפייה עדיין' : 'אין מוצרים עם אפייה עדיין'}</p>
      <p class="form-hint">שייך פרופיל לקבוצה או לקטגוריה · מוצרים בודדים יופיעו ב«מפורט למוצרים»</p>
    </div>`;

  container.innerHTML = `
    <div class="card baking-station-intro">
      <div class="card-title">רשימת אפיות</div>
      <p class="form-hint" style="margin:0">לפי קטגוריות = קטגוריות עם פרופיל · מפורט למוצרים = כל מוצר · לפי סדר הקטלוג · מחולק לתנור גדול / קטן</p>
    </div>
    <div class="card baking-profiles-card">
      <div class="section-header baking-profiles-header">
        <h2>פרופילי אפייה</h2>
        <div class="baking-profiles-header-actions">
          <button type="button" class="btn btn-secondary btn-sm btn-icon" id="baking-share-btn" title="שתף קובץ אפיות">📤</button>
          <button type="button" class="btn btn-primary btn-sm" id="add-baking-profile-btn">+ פרופיל</button>
        </div>
      </div>
      <div class="baking-profile-list">${profileCatalog}</div>
    </div>
    ${listHTML}`;

  container.querySelectorAll('.baking-view-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.bakingView;
      if (!mode || mode === viewMode) return;
      setBakingViewMode(container, mode);
      reloadBakingTab(container);
    });
  });

  document.getElementById('baking-share-btn')?.addEventListener('click', () => {
    openBakingShareChooser(productCatalog, { defaultMode: viewMode });
  });

  document.getElementById('add-baking-profile-btn')?.addEventListener('click', () => {
    openBakingProfileForm(container, { layout, productCatalog });
  });

  const reopenLinks = async (profileId, opts) => {
    const ctx = await loadFreshBakingContext();
    openBakingProfileLinksModal(container, profileId, ctx, opts);
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

  container.querySelectorAll('.baking-product-row, .baking-category-row').forEach((row) => {
    row.addEventListener('click', () => {
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
      const ctx = await loadFreshBakingContext();
      const profile = await getBakingProfile(Number(btn.dataset.id));
      if (profile) openBakingProfileForm(container, { profile, ...ctx });
    });
  });

  container.querySelectorAll('.delete-baking-profile').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('למחוק פרופיל אפייה? השיוכים לקבוצות, קטגוריות, מוצרים ומתכונים יוסרו.')) return;
      try {
        await deleteBakingProfile(Number(btn.dataset.id));
        showToast('נמחק');
        await reloadBakingTab(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });
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

function findRecipePlacementGroupId(groups, categoryId) {
  const cid = Number(categoryId);
  if (!cid) return groups[0]?.id || '';
  for (const group of groups) {
    if ((group.categories || []).some((c) => Number(c.id) === cid)) return group.id;
  }
  return groups[0]?.id || '';
}

function buildRecipePlacementGroupOptions(groups, selectedGroupId) {
  return (groups || []).map((g) =>
    `<option value="${g.id}"${Number(selectedGroupId) === Number(g.id) ? ' selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
}

function buildRecipePlacementCategoryOptions(groups, groupId, selectedCategoryId) {
  const group = (groups || []).find((g) => Number(g.id) === Number(groupId));
  const cats = group?.categories || [];
  if (!cats.length) return '<option value="">אין קטגוריות בקבוצה זו</option>';
  const preferred = cats.some((c) => Number(c.id) === Number(selectedCategoryId))
    ? Number(selectedCategoryId)
    : cats[0].id;
  return cats.map((c) =>
    `<option value="${c.id}"${Number(c.id) === preferred ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
}

function buildRecipePlacementFieldsHTML(groups, selectedCategoryId) {
  if (!groups?.length) {
    return `<p class="form-hint" style="color:var(--warning)">אין קבוצות סידור — הוסף קבוצה וקטגוריה לפני יצירת מתכון</p>`;
  }
  const hasAnyCat = groups.some((g) => (g.categories || []).length);
  if (!hasAnyCat) {
    return `<p class="form-hint" style="color:var(--warning)">אין קטגוריות — לחץ «+ קטגוריה» ואז צור מתכון</p>`;
  }
  const groupId = findRecipePlacementGroupId(groups, selectedCategoryId);
  return `
    <div class="form-group recipe-placement-fields">
      <label>שיוך במתכונים</label>
      <div class="recipe-placement-row">
        <div class="recipe-placement-field">
          <label for="recipe-placement-group" class="form-hint" style="margin:0 0 4px">קטגוריה כללית (קבוצת סידור)</label>
          <select id="recipe-placement-group">${buildRecipePlacementGroupOptions(groups, groupId)}</select>
        </div>
        <div class="recipe-placement-field">
          <label for="recipe-category" class="form-hint" style="margin:0 0 4px">קטגוריה</label>
          <select id="recipe-category">${buildRecipePlacementCategoryOptions(groups, groupId, selectedCategoryId)}</select>
        </div>
      </div>
    </div>`;
}

function bindRecipePlacementFields(groups) {
  const groupSel = document.getElementById('recipe-placement-group');
  const catSel = document.getElementById('recipe-category');
  if (!groupSel || !catSel) return;
  groupSel.addEventListener('change', () => {
    const currentCat = catSel.value;
    catSel.innerHTML = buildRecipePlacementCategoryOptions(groups, groupSel.value, currentCat);
  });
}

function openNewRecipeBuilder(container, { layout, productCatalog, categoryId } = {}) {
  const groups = layout?.groups || [];
  const hasCat = groups.some((g) => (g.categories || []).length);
  if (!hasCat) {
    showToast('קודם הוסף קטגוריה (למשל מילית / בצק)');
    return;
  }
  openRecipeForm(container, {
    categoryId: categoryId || undefined,
    productCatalog,
    layout,
  });
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

function compareCatalogCategories(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

function iterateProductCatalogCategories(productCatalog, { categoryId, groupId } = {}) {
  const sections = [];
  const pushSection = (cat, groupName) => {
    if (categoryId && Number(cat.id) !== Number(categoryId)) return;
    const products = (cat.products || []).filter((p) => p.active !== false);
    if (!products.length) return;
    sections.push({ cat, groupName, products });
  };

  if (groupId) {
    const group = productCatalog.groups?.find((g) => Number(g.id) === Number(groupId));
    if (group) {
      for (const cat of group.categories.slice().sort(compareCatalogCategories)) {
        pushSection(cat, group.name);
      }
    }
    return sections;
  }

  for (const group of productCatalog.groups || []) {
    for (const cat of group.categories.slice().sort(compareCatalogCategories)) {
      pushSection(cat, group.name);
    }
  }
  for (const cat of (productCatalog.ungrouped || []).slice().sort(compareCatalogCategories)) {
    pushSection(cat, '');
  }
  return sections;
}

function collectProductsFromCatalog(productCatalog, { categoryId, groupId } = {}) {
  return iterateProductCatalogCategories(productCatalog, { categoryId, groupId })
    .flatMap((section) => section.products);
}

function buildRecipeProductCheckboxListHTML(productCatalog, recipe, { selectedIds } = {}) {
  const filterCatId = recipe?._productFilterCategoryId || '';
  const selected = selectedIds
    ? new Set(selectedIds)
    : new Set(recipe?.linkedProductIds || []);
  const sections = iterateProductCatalogCategories(productCatalog, {
    categoryId: filterCatId ? Number(filterCatId) : null,
  });

  if (!sections.length) {
    return '<p class="form-hint">אין מוצרים — בחר סינון קטגוריה או הוסף מוצרים</p>';
  }

  return sections.map(({ cat, groupName, products }) => {
    const heading = groupName ? `${groupName} › ${cat.name}` : cat.name;
    const items = products.map((p) => `
        <label class="checkbox-label recipe-product-pick">
          <input type="checkbox" class="recipe-product-cb" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>
          ${escapeHtml(p.name)}
        </label>`).join('');
    return `
      <div class="recipe-product-cat-block">
        <div class="recipe-product-cat-heading">${escapeHtml(heading)}</div>
        ${items}
      </div>`;
  }).join('');
}

function sortProductIdsByCatalogOrder(productIds, productCatalog) {
  const orderMap = new Map();
  let idx = 0;
  for (const { products } of iterateProductCatalogCategories(productCatalog)) {
    for (const p of products) orderMap.set(p.id, idx++);
  }
  return [...productIds].sort((a, b) => (orderMap.get(a) ?? 999999) - (orderMap.get(b) ?? 999999));
}

function inferRecipeProductLinkScope(recipe) {
  if (recipe?.linkedProductGroupIds?.length) return 'group';
  if (recipe?.linkedProductCategoryIds?.length) return 'category';
  if (recipe?.linkedProductIds?.length) return 'product';
  if (recipe?.linkedProductGroupId) return 'group';
  if (recipe?.linkedProductCategoryId) return 'category';
  return '';
}

function collectProductCategoriesFromCatalog(productCatalog) {
  const categories = [];
  for (const group of productCatalog.groups || []) {
    for (const cat of group.categories.slice().sort(compareCatalogCategories)) {
      categories.push({ ...cat, groupName: group.name });
    }
  }
  for (const cat of (productCatalog.ungrouped || []).slice().sort(compareCatalogCategories)) {
    categories.push({ ...cat, groupName: '' });
  }
  return categories;
}

function buildRecipeProductScopePickHTML(scopeType, productCatalog, recipe) {
  if (scopeType === 'group') {
    const selected = new Set(recipe?.linkedProductGroupIds || (recipe?.linkedProductGroupId ? [recipe.linkedProductGroupId] : []));
    const groups = productCatalog.groups || [];
    const groupList = groups.length
      ? groups.map((g) => `
          <label class="checkbox-label recipe-product-pick">
            <input type="checkbox" class="recipe-group-cb" value="${g.id}" ${selected.has(g.id) ? 'checked' : ''}>
            ${escapeHtml(g.name)}
          </label>`).join('')
      : '<p class="form-hint">אין קטגוריות כלליות</p>';
    return `
      <div class="recipe-product-picker" id="recipe-group-list" style="max-height:160px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
        ${groupList}
      </div>
      <p class="form-hint" style="margin-top:6px">המתכון ישויך לכל המוצרים בקטגוריות הכלליות שנבחרו</p>`;
  }
  if (scopeType === 'category') {
    const selected = new Set(recipe?.linkedProductCategoryIds || (recipe?.linkedProductCategoryId ? [recipe.linkedProductCategoryId] : []));
    const categories = collectProductCategoriesFromCatalog(productCatalog);
    const categoryList = categories.length
      ? categories.map((cat) => {
        const label = cat.groupName ? `${cat.groupName} › ${cat.name}` : cat.name;
        return `
          <label class="checkbox-label recipe-product-pick">
            <input type="checkbox" class="recipe-category-cb" value="${cat.id}" ${selected.has(cat.id) ? 'checked' : ''}>
            ${escapeHtml(label)}
          </label>`;
      }).join('')
      : '<p class="form-hint">אין קטגוריות מוצר</p>';
    return `
      <div class="recipe-product-picker" id="recipe-category-list" style="max-height:160px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
        ${categoryList}
      </div>
      <p class="form-hint" style="margin-top:6px">המתכון ישויך לכל המוצרים בקטגוריות שנבחרו</p>`;
  }
  if (scopeType === 'product') {
    const filterCatId = recipe?._productFilterCategoryId || '';
    const selectedIds = recipe?.linkedProductIds || [];
    const catOptions = buildProductCategorySelectHTML(productCatalog, filterCatId)
      .replace('<option value="">— ללא (אופציונלי) —</option>', '<option value="">כל המוצרים</option>');
    const selectedNames = sortProductIdsByCatalogOrder(selectedIds, productCatalog)
      .map((id) => {
        const found = collectProductsFromCatalog(productCatalog).find((p) => Number(p.id) === Number(id));
        return found ? found.name : `#${id}`;
      });
    const selectedList = selectedNames.length
      ? `<ul class="recipe-linked-products-list">${selectedNames.map((name) => `
          <li class="recipe-linked-products-item"><span class="recipe-linked-products-name">${escapeHtml(name)}</span></li>`).join('')}</ul>`
      : '<p class="form-hint recipe-linked-products-empty">אין מוצרים משויכים</p>';
    return `
      <div class="recipe-linked-products-panel">
        <div class="recipe-linked-products-head">
          <strong>מוצרים משויכים (${selectedNames.length})</strong>
          <button type="button" class="btn btn-secondary btn-sm" id="recipe-clear-product-links">נקה בחירות</button>
        </div>
        <div id="recipe-linked-products-summary">${selectedList}</div>
      </div>
      <div class="form-group" style="margin-bottom:8px">
        <label for="recipe-product-filter-category">סינון לפי קטגוריה (אופציונלי)</label>
        <select id="recipe-product-filter-category" style="width:100%">${catOptions}</select>
      </div>
      <div class="recipe-product-picker" id="recipe-product-list" style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
        ${buildRecipeProductCheckboxListHTML(productCatalog, recipe)}
      </div>`;
  }
  return '<p class="form-hint">ללא שיוך למוצרים</p>';
}

function buildOptionalProductLinkerHTML(productCatalog, recipe) {
  const scopeType = inferRecipeProductLinkScope(recipe);
  return `
    <label>שיוך מנה למוצר (אופציונלי)</label>
    <p class="form-hint" style="margin:4px 0 8px">קובע לאילו מוצרים תופיע המנה במסך «מנות» ובתזרים — אפשר לשייך כבר עכשיו בזמן בניית המתכון.</p>
    <div class="baking-scope-type-row recipe-product-scope-row" role="radiogroup" aria-label="סוג שיוך מוצר" style="margin:8px 0 10px">
      <label class="baking-scope-type-option"><input type="radio" name="recipe-product-scope-type" value=""${!scopeType ? ' checked' : ''}> ללא</label>
      <label class="baking-scope-type-option"><input type="radio" name="recipe-product-scope-type" value="group"${scopeType === 'group' ? ' checked' : ''}> קטגוריה כללית</label>
      <label class="baking-scope-type-option"><input type="radio" name="recipe-product-scope-type" value="category"${scopeType === 'category' ? ' checked' : ''}> קטגוריה</label>
      <label class="baking-scope-type-option"><input type="radio" name="recipe-product-scope-type" value="product"${scopeType === 'product' ? ' checked' : ''}> מוצר</label>
    </div>
    <div id="recipe-product-scope-pick-row">
      ${buildRecipeProductScopePickHTML(scopeType, productCatalog, recipe)}
    </div>`;
}

function bindOptionalProductLinker(productCatalog, recipe) {
  const pickRow = document.getElementById('recipe-product-scope-pick-row');
  if (!pickRow) return;

  const getSelectedScope = () => document.querySelector('input[name="recipe-product-scope-type"]:checked')?.value || '';
  let stickyProductIds = new Set((recipe?.linkedProductIds || []).map(Number).filter(Boolean));

  const syncStickyFromDom = () => {
    document.querySelectorAll('.recipe-product-cb').forEach((cb) => {
      const id = Number(cb.value);
      if (!id) return;
      if (cb.checked) stickyProductIds.add(id);
      else stickyProductIds.delete(id);
    });
  };

  const renderSelectedSummary = () => {
    const summary = document.getElementById('recipe-linked-products-summary');
    const head = document.querySelector('.recipe-linked-products-head strong');
    if (!summary) return;
    const selectedIds = [...stickyProductIds];
    const selectedNames = sortProductIdsByCatalogOrder(selectedIds, productCatalog)
      .map((id) => {
        const found = collectProductsFromCatalog(productCatalog).find((p) => Number(p.id) === Number(id));
        return found ? found.name : `#${id}`;
      });
    if (head) head.textContent = `מוצרים משויכים (${selectedNames.length})`;
    summary.innerHTML = selectedNames.length
      ? `<ul class="recipe-linked-products-list">${selectedNames.map((name) => `
          <li class="recipe-linked-products-item"><span class="recipe-linked-products-name">${escapeHtml(name)}</span></li>`).join('')}</ul>`
      : '<p class="form-hint recipe-linked-products-empty">אין מוצרים משויכים</p>';
  };

  const bindProductScopePickEvents = () => {
    document.getElementById('recipe-product-filter-category')?.addEventListener('change', (e) => {
      syncStickyFromDom();
      const filterCatId = e.target.value || '';
      const listHost = document.getElementById('recipe-product-list');
      if (!listHost) return;
      listHost.innerHTML = buildRecipeProductCheckboxListHTML(productCatalog, {
        ...recipe,
        _productFilterCategoryId: filterCatId,
      }, { selectedIds: [...stickyProductIds] });
      listHost.querySelectorAll('.recipe-product-cb').forEach((cb) => {
        cb.addEventListener('change', () => {
          syncStickyFromDom();
          renderSelectedSummary();
        });
      });
      renderSelectedSummary();
    });

    document.getElementById('recipe-clear-product-links')?.addEventListener('click', () => {
      stickyProductIds = new Set();
      document.querySelectorAll('.recipe-product-cb').forEach((cb) => {
        cb.checked = false;
      });
      renderSelectedSummary();
      showToast('הבחירות נוקו');
    });

    document.querySelectorAll('.recipe-product-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        syncStickyFromDom();
        renderSelectedSummary();
      });
    });
  };

  const refreshPickRow = () => {
    syncStickyFromDom();
    const scopeType = getSelectedScope();
    const selectedGroups = [...pickRow.querySelectorAll('.recipe-group-cb:checked')].map((cb) => Number(cb.value));
    const selectedCategories = [...pickRow.querySelectorAll('.recipe-category-cb:checked')].map((cb) => Number(cb.value));
    if (scopeType === 'product') {
      stickyProductIds = new Set([...stickyProductIds]);
    }
    pickRow.innerHTML = buildRecipeProductScopePickHTML(scopeType, productCatalog, {
      ...recipe,
      linkedProductIds: [...stickyProductIds],
      linkedProductGroupIds: selectedGroups.length ? selectedGroups : recipe?.linkedProductGroupIds,
      linkedProductCategoryIds: selectedCategories.length ? selectedCategories : recipe?.linkedProductCategoryIds,
    });
    bindProductScopePickEvents();
    renderSelectedSummary();
  };

  document.querySelectorAll('input[name="recipe-product-scope-type"]').forEach((radio) => {
    radio.addEventListener('change', refreshPickRow);
  });
  bindProductScopePickEvents();
  renderSelectedSummary();

  // חשיפה לקריאה בשמירה — כולל מוצרים מחוץ לסינון
  pickRow.dataset.stickyProductIds = '1';
  pickRow._getStickyProductIds = () => {
    syncStickyFromDom();
    return [...stickyProductIds];
  };
}

function readRecipeProductLinkFromForm() {
  const scopeType = document.querySelector('input[name="recipe-product-scope-type"]:checked')?.value || '';
  if (scopeType === 'group') {
    return {
      linkedProductGroupIds: [...document.querySelectorAll('.recipe-group-cb:checked')].map((cb) => Number(cb.value)).filter(Boolean),
      linkedProductCategoryIds: [],
      linkedProductIds: [],
    };
  }
  if (scopeType === 'category') {
    return {
      linkedProductGroupIds: [],
      linkedProductCategoryIds: [...document.querySelectorAll('.recipe-category-cb:checked')].map((cb) => Number(cb.value)).filter(Boolean),
      linkedProductIds: [],
    };
  }
  if (scopeType === 'product') {
    const pickRow = document.getElementById('recipe-product-scope-pick-row');
    const stickyIds = typeof pickRow?._getStickyProductIds === 'function'
      ? pickRow._getStickyProductIds()
      : [...document.querySelectorAll('.recipe-product-cb:checked')].map((cb) => Number(cb.value)).filter(Boolean);
    return {
      linkedProductGroupIds: [],
      linkedProductCategoryIds: [],
      linkedProductIds: stickyIds,
    };
  }
  return { linkedProductGroupIds: [], linkedProductCategoryIds: [], linkedProductIds: [] };
}

function formatRecipeProductLinkLabel(recipe, productCatalog) {
  const groupIds = recipe?.linkedProductGroupIds?.length
    ? recipe.linkedProductGroupIds
    : (recipe?.linkedProductGroupId ? [recipe.linkedProductGroupId] : []);
  if (groupIds.length) {
    const names = groupIds.map((id) => findProductGroupName(productCatalog, id)).filter(Boolean);
    return names.length ? `קבוצות: ${names.join(', ')}` : 'קבוצות';
  }
  const catIds = recipe?.linkedProductCategoryIds?.length
    ? recipe.linkedProductCategoryIds
    : (recipe?.linkedProductCategoryId ? [recipe.linkedProductCategoryId] : []);
  if (catIds.length) {
    const names = catIds.map((id) => findProductCategoryName(productCatalog, id)).filter(Boolean);
    return names.length ? `קטגוריות: ${names.join(', ')}` : 'קטגוריות';
  }
  return '';
}

async function renderRecipeBook(container, { groups, allSubs, productMap, productCatalog }) {
  const [allRecipes, bakingProfiles] = await Promise.all([
    getRecipes(null),
    getBakingProfiles(),
  ]);
  const profileMap = new Map(bakingProfiles.map((p) => [p.id, p]));
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
      const subRecipes = groupRecipes.filter((r) => r.categoryId === sub.id && !r.parentRecipeId);
      if (!subRecipes.length) return '';
      return `
            <section class="recipe-book-sub">
              <h3 class="recipe-book-sub-title">${escapeHtml(sub.name)}</h3>
              ${subRecipes.map((r) => {
        const detail = details.find((d) => d.id === r.id);
        return renderRecipeBookItemHTML(r, detail, {
          productCatalog,
          productMap,
          profileMap,
        });
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
      productCatalog,
      productMap,
      profileMap,
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

function renderRecipeProductYieldStatsHTML(recipe, ingredients) {
  const { unitG, units, summary } = getRecipeProductYieldInfo(recipe, ingredients);
  const yieldLines = [];
  if (summary.totalRecipeKg > 0) {
    yieldLines.push(`<div class="recipe-yield-stat"><span>מנה אחת</span><strong>${formatKgWeight(summary.totalRecipeKg)}</strong></div>`);
  }
  if (unitG > 0) {
    yieldLines.push(`<div class="recipe-yield-stat"><span>יחידת חלוקה</span><strong>${formatSubdivisionWeight(unitG)}</strong></div>`);
  }
  if (units) {
    yieldLines.push(`<div class="recipe-yield-stat highlight"><span>יוצא מהמנה</span><strong>${formatRecipeQuantity(units.totalUnits)} יחידות</strong></div>`);
  } else if (summary.totalRecipeKg > 0) {
    yieldLines.push(`<p class="form-hint">הזן משקל יחידת חלוקה (ק"ג) כדי לחשב כמה יחידות יוצאות מהמנה (${formatKgWeight(summary.totalRecipeKg)}).</p>`);
  } else {
    yieldLines.push('<p class="form-hint">הוסף חומרי גלם ומשקל יחידת חלוקה כדי לחשב תשואה.</p>');
  }
  return yieldLines.join('');
}

function renderRecipeProductYieldBlockHTML(recipe, ingredients, { showCalculator = false } = {}) {
  const statsHtml = renderRecipeProductYieldStatsHTML(recipe, ingredients);
  const { unitG, units } = getRecipeProductYieldInfo(recipe, ingredients);

  const calcHtml = showCalculator && ingredients.length && unitG > 0 && units ? `
      <div class="recipe-production-calc">
        <label class="recipe-production-calc-label" for="recipe-target-products">כמה יחידות לייצר?</label>
        <input type="number" id="recipe-target-products" class="recipe-target-products-input" min="0.1" step="0.1" placeholder="למשל: 24">
        <div id="recipe-scaled-ingredients-host" class="recipe-scaled-ingredients-host" hidden></div>
      </div>` : '';

  if (!statsHtml && !calcHtml) return '';

  return `
    <section class="recipe-sheet-section recipe-product-yield-section" aria-label="תשואת מוצרים">
      <h2 class="recipe-sheet-section-title">תשואת מוצרים</h2>
      <div class="recipe-yield-stats">${statsHtml}</div>
      ${calcHtml}
    </section>`;
}

function renderScaledIngredientsForProductionHTML(scaledIngredients, recipe, matCtx, { targetCount, ratio } = {}) {
  if (!scaledIngredients?.length) return '';
  let totalCost = 0;
  const rows = scaledIngredients.map((ing, i) => {
    const scaledIng = { ...ing, quantity: ing.scaledQuantity ?? ing.quantity };
    const { lineCost, mat } = matCtx ? resolveIngredientDisplay(scaledIng, matCtx) : { lineCost: 0, mat: null };
    totalCost += lineCost;
    return `
      <tr>
        <td class="col-num">${i + 1}</td>
        <td class="col-name">${escapeHtml(ing.name)}</td>
        <td class="col-qty"><span class="recipe-qty-value">${formatRecipeQuantity(scaledIng.quantity)}</span></td>
        <td class="col-unit">${escapeHtml(ing.unit)}</td>
        <td class="col-cost">${mat ? formatMoney(lineCost) : '—'}</td>
      </tr>`;
  }).join('');

  return `
    <div class="recipe-scaled-result">
      <p class="recipe-scaled-intro">חומרי גלם ל-<strong>${escapeHtml(String(targetCount))}</strong> יחידות${ratio ? ` (×${formatRatioFactor(ratio)} מהמתכון)` : ''}</p>
      <div class="recipe-sheet-table-wrap">
        <table class="recipe-sheet-table">
          <thead>
            <tr>
              <th scope="col" class="col-num">#</th>
              <th scope="col" class="col-name">חומר גלם</th>
              <th scope="col" class="col-qty">כמות</th>
              <th scope="col" class="col-unit">יחידה</th>
              <th scope="col" class="col-cost">מחיר חומר גלם</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr class="recipe-cost-total-row">
              <td colspan="4" class="recipe-cost-total-label">סה״כ חומרי גלם</td>
              <td class="col-cost"><strong>${formatMoney(totalCost)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function bindRecipeProductionCalculator(recipe, ingredients, matCtx, { getRecipe, getIngredients } = {}) {
  const input = document.getElementById('recipe-target-products');
  const host = document.getElementById('recipe-scaled-ingredients-host');
  if (!input || !host) return;

  const resolveRecipe = () => (getRecipe ? getRecipe() : recipe);
  const resolveIngredients = () => (getIngredients ? getIngredients() : ingredients);

  const render = () => {
    const currentRecipe = resolveRecipe();
    const currentIngredients = resolveIngredients();
    const target = Number(input.value);
    if (!target || target <= 0) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    const { units } = getRecipeProductYieldInfo(currentRecipe, currentIngredients);
    const scaled = scaleRecipeIngredientsForProductCount(currentIngredients, currentRecipe, target);
    if (!scaled || !units) {
      host.hidden = false;
      host.innerHTML = '<p class="form-hint">לא ניתן לחשב — ודא שמשקל יחידת חלוקה וחומרי גלם מוגדרים.</p>';
      return;
    }
    const ratio = target / units.totalUnits;
    host.hidden = false;
    host.innerHTML = renderScaledIngredientsForProductionHTML(scaled, currentRecipe, matCtx, {
      targetCount: target,
      ratio,
    });
  };

  input.addEventListener('input', render);
  input.addEventListener('change', render);
}

function renderRecipeWeightSummaryHTML(ingredients, recipe, options) {
  const summary = getRecipeWeightSummary(ingredients, { ...options, recipe });
  if (!summary.mainText) return '';

  const unitGrams = recipe?.portionWeightGrams ? Number(recipe.portionWeightGrams) : null;
  const units = unitGrams && summary.totalRecipeKg > 0
    ? computeRecipeProductUnits(summary.totalRecipeKg, 1, unitGrams)
    : null;

  const unitWeightHtml = unitGrams
    ? `<div class="recipe-portion-weight-line"><span>יחידת חלוקה:</span> <strong>${formatSubdivisionWeight(unitGrams)}</strong></div>`
    : '';

  const unitsHtml = units
    ? `<div class="recipe-unit-yield-line">
        <span>יוצא מהמנה:</span> <strong>${formatRecipeQuantity(units.totalUnits)} יחידות</strong>
      </div>`
    : '';

  return `
    <div class="recipe-weight-summary">
      <div class="recipe-weight-main">
        <span class="recipe-weight-label">משקל מנה</span>
        <strong class="recipe-weight-value">${escapeHtml(summary.mainText)}</strong>
      </div>
      ${summary.breakdownText ? `<div class="recipe-weight-breakdown">${escapeHtml(summary.breakdownText)}</div>` : ''}
      ${unitWeightHtml}
      ${unitsHtml}
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
  const subdivisionKg = document.getElementById('recipe-subdivision-kg')?.value;
  return {
    ...(baseRecipe || {}),
    yieldPortions: 1,
    showTotalAsPortions: false,
    portionWeightGrams: subdivisionKg ? gramsFromSubdivisionKg(subdivisionKg) : null,
  };
}

function readRecipeFormDraft() {
  if (!document.getElementById('recipe-name')) return null;
  return {
    name: document.getElementById('recipe-name').value,
    categoryId: document.getElementById('recipe-category')?.value,
    subdivisionKg: document.getElementById('recipe-subdivision-kg')?.value,
    notes: document.getElementById('recipe-notes')?.value,
  };
}

function applyRecipeFormDraft(draft) {
  if (!draft) return;
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el && value != null) el.value = value;
  };
  setVal('recipe-name', draft.name);
  setVal('recipe-category', draft.categoryId);
  setVal('recipe-subdivision-kg', draft.subdivisionKg);
  setVal('recipe-notes', draft.notes);
}

function buildRecipeMaterialContext(mats, suppliers) {
  return {
    matById: new Map(mats.map((m) => [m.id, m])),
    byNameKey: buildMaterialsByNameKey(mats),
    supMap: new Map(suppliers.map((s) => [s.id, s.name])),
  };
}

function ingredientMaterialHasPrice(mat) {
  if (!mat) return false;
  const effective = getMaterialEffectivePricePerKg(mat);
  if (effective != null && effective > 0) return true;
  return (Number(mat.unitPrice) || 0) > 0;
}

/** סטטוס שיוך לספקים: linked / no-price / unlinked */
function getIngredientSupplierStatus(mat) {
  if (!mat) return 'unlinked';
  return ingredientMaterialHasPrice(mat) ? 'linked' : 'no-price';
}

function ingredientStatusDotHTML(status) {
  const map = {
    linked: { cls: 'recipe-ing-status--linked', title: 'משויך לספקים · יש מחיר', label: 'ירוק' },
    'no-price': { cls: 'recipe-ing-status--no-price', title: 'משויך לספקים · אין מחיר', label: 'צהוב' },
    unlinked: { cls: 'recipe-ing-status--unlinked', title: 'לא משויך לספקים', label: 'אדום' },
  };
  const info = map[status] || map.unlinked;
  return `<span class="recipe-ing-status ${info.cls}" title="${info.title}" aria-label="${info.title}"></span>`;
}

function resolveIngredientDisplay(ing, ctx) {
  const { mat, priceSource, usedRecipeDefault } = resolveRecipeIngredientMaterial(ing, ctx);
  const lineCost = computeIngredientLineCost(ing, mat);
  const ppk = mat ? computePricePerKg(mat.unitPrice, mat.packageWeightGrams) : null;
  const status = getIngredientSupplierStatus(mat);
  let badge = 'לא משויך לספקים';
  if (mat) {
    const supName = ctx.supMap.get(mat.supplierId) || 'ספק';
    if (status === 'no-price') {
      badge = `משויך · ללא מחיר · ${supName}`;
    } else if (priceSource === 'max') {
      badge = usedRecipeDefault
        ? `ברירת מחדל · ${supName}`
        : 'מחיר מקס׳ (אוטומטי)';
    } else {
      badge = `${supName} (ידני)`;
    }
  }
  return { mat, lineCost, badge, priceSource, ppk, usedRecipeDefault, status };
}

function renderRecipeCostSummaryHTML(ingredients, ctx) {
  let total = 0;
  let linked = 0;
  let noPrice = 0;
  let unlinked = 0;
  for (const ing of ingredients || []) {
    const { lineCost, status } = resolveIngredientDisplay(ing, ctx);
    total += lineCost;
    if (status === 'linked') linked += 1;
    else if (status === 'no-price') noPrice += 1;
    else unlinked += 1;
  }
  if (!ingredients?.length) return '';
  return `
    <div class="recipe-cost-summary">
      <span class="recipe-cost-label">סה״כ עלות למנה</span>
      <strong class="recipe-cost-value">${formatMoney(total)}</strong>
      <span class="form-hint">המתכון = מנה אחת · מחירים מספקים</span>
      <div class="recipe-ing-status-legend" aria-hidden="true">
        <span><span class="recipe-ing-status recipe-ing-status--linked"></span> משויך (${linked})</span>
        <span><span class="recipe-ing-status recipe-ing-status--no-price"></span> בלי מחיר (${noPrice})</span>
        <span><span class="recipe-ing-status recipe-ing-status--unlinked"></span> לא משויך (${unlinked})</span>
      </div>
    </div>`;
}

function renderRecipeCostAndWeightHTML(ingredients, recipe, ctx, options, { showCosts = true } = {}) {
  const costHtml = showCosts ? renderRecipeCostSummaryHTML(ingredients, ctx) : '';
  return costHtml + renderRecipeWeightSummaryHTML(ingredients, recipe, options);
}

function renderRecipeIngredientsHeaderHTML() {
  return `
    <div class="recipe-ingredients-header" aria-hidden="true">
      <span class="recipe-ing-col-name">חומר גלם</span>
      <span class="recipe-ing-col-qty">כמות</span>
      <span class="recipe-ing-col-unit">יחידה</span>
      <span class="recipe-ing-col-cost">מחיר חומר גלם</span>
      <span class="recipe-ing-col-actions"></span>
    </div>`;
}

function renderRecipeIngredientRowHTML(ing, ctx) {
  const kind = ing.unitKind || normalizeRecipeUnitKind(ing.unit);
  const { lineCost, badge, mat, status } = resolveIngredientDisplay(ing, ctx);
  return `
    <div class="filter-row recipe-ing-row" style="margin-bottom:6px;align-items:center" data-ing-id="${ing.id}" data-ing-status="${status}">
      <button type="button" class="recipe-ing-name pick-ing-supplier" data-ing-id="${ing.id}" title="לחץ לעריכת חומר גלם ובחירה מספקים">
        <span class="recipe-ing-name-text">${ingredientStatusDotHTML(status)} ✏️ ${escapeHtml(ing.name)}</span>
        <span class="recipe-ing-price-meta">${escapeHtml(badge)} · לחץ לעריכה</span>
      </button>
      <input type="number" class="ing-qty" min="0.001" step="0.001" value="${formatRecipeQuantity(ing.quantity)}" style="width:80px">
      <select class="ing-unit" style="width:72px">
        ${RECIPE_WEIGHT_UNITS.map((u) => `
          <option value="${u.id}" ${kind === u.id ? 'selected' : ''}>${u.label}</option>`).join('')}
      </select>
      <span class="recipe-ing-line-cost" title="מחיר לפי הכמות במתכון">${mat && status !== 'no-price' ? formatMoney(lineCost) : '—'}</span>
      <button type="button" class="btn btn-danger btn-sm del-ing" data-id="${ing.id}">🗑</button>
    </div>`;
}

async function openIngredientSupplierPicker(container, recipe, ing, ctx, mats, suppliers, productCatalog, catalogLayout, returnToView, formDraft) {
  const offers = await getMaterialsByIngredientName(ing.name);
  const currentSource = getIngredientPriceSource(ing);
  const defaultMat = pickRecipeDefaultMaterial(offers);
  const maxMat = pickHighestPricedMaterial(offers);
  const autoMat = defaultMat || maxMat;
  const currentMat = Number(ing.rawMaterialId)
    ? mats.find((m) => m.id === Number(ing.rawMaterialId))
    : null;

  const reopenRecipeEdit = async (toastMsg) => {
    try { await syncProductCostFromRecipe(recipe.id); } catch { /* no products */ }
    closeModal();
    openRecipeForm(container, {
      recipe: await getRecipe(recipe.id),
      productCatalog,
      layout: catalogLayout,
      returnToView,
      draft: formDraft,
    });
    if (toastMsg) showToast(toastMsg);
  };

  const defaultSupName = defaultMat
    ? (ctx.supMap.get(defaultMat.supplierId) || 'ספק')
    : '';
  const autoLabel = defaultMat
    ? `ברירת מחדל · ${defaultSupName}`
    : 'מחיר גבוה ביותר (אוטומטי)';
  const autoMeta = autoMat
    ? `${formatMoney(materialComparisonPriceDisplay(autoMat))}/ק"ג משוער`
    : 'אין מחירים';

  openModal({
    title: `עריכת חומר גלם`,
    modalClass: 'modal-ingredient-edit',
    bodyHTML: `
      <p class="form-hint ingredient-edit-intro">חפש ובחר חומר גלם מרשימת הספקים, או בחר מחיר מההצעות למטה.</p>
      <div class="form-group" style="margin-top:0">
        <label for="change-ing-mat-search">חומר גלם מספקים</label>
        <div class="mat-search-wrap" style="position:relative">
          <input type="text" id="change-ing-mat-search" value="${escapeHtml(currentMat?.name || ing.name)}" placeholder="חפש לפי שם חומר גלם..." autocomplete="off">
          <input type="hidden" id="change-ing-mat-id" value="${currentMat?.id || ''}">
          <ul class="mat-search-list hidden" id="change-ing-mat-list"></ul>
        </div>
        <p class="form-hint">הקלד לחיפוש — לחץ על תוצאה לבחירה מיידית</p>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="change-ing-mat-btn" style="width:100%;margin-bottom:16px">החל לפי שם בשדה (ללא בחירה מהרשימה)</button>
      <hr style="border:none;border-top:1px solid var(--border);margin:0 0 16px">
      <p class="form-hint" style="margin-top:0">תמחור ל<strong>${escapeHtml(ing.name)}</strong> — ${defaultMat ? `ברירת מחדל: ${escapeHtml(defaultSupName)}` : 'ברירת מחדל: המחיר הגבוה ביותר'} · ניתן לבחור ספק אחר לעקיפה במתכון זה</p>
      <div class="ing-price-picker">
        <button type="button" class="ing-price-option${currentSource === 'max' ? ' active' : ''}" data-source="max">
          <span class="ing-price-option-name">${escapeHtml(autoLabel)}</span>
          <span class="ing-price-option-meta">${autoMeta}</span>
        </button>
        ${offers.map((m) => {
    const sup = ctx.supMap.get(m.supplierId) || 'ספק';
    const ppk = computePricePerKg(m.unitPrice, m.packageWeightGrams);
    const isActive = currentSource === 'supplier' && Number(ing.rawMaterialId) === m.id;
    const defMark = m.isRecipeDefault ? ' ★' : '';
    return `
        <button type="button" class="ing-price-option${isActive ? ' active' : ''}" data-source="supplier" data-mid="${m.id}">
          <span class="ing-price-option-name">${escapeHtml(sup)}${defMark} · ${escapeHtml(m.name)}</span>
          <span class="ing-price-option-meta">${formatMoney(m.unitPrice)}/${escapeHtml(m.unit)}${ppk != null ? ` · ${formatMoney(ppk)}/ק"ג` : ''}</span>
        </button>`;
  }).join('')}
        ${!offers.length ? '<p class="form-hint">אין התאמות מדויקות לשם — חפש ברשימת הספקים למעלה</p>' : ''}
      </div>`,
    footerHTML: '<button class="btn btn-secondary modal-cancel">חזרה למתכון</button>',
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', () => {
    closeModal();
    openRecipeForm(container, {
      recipe,
      productCatalog,
      layout: catalogLayout,
      returnToView,
      draft: formDraft,
    });
  });

  const applyMaterialSelection = async (mat, toastMsg = 'חומר גלם עודכן ✓') => {
    if (!mat) return;
    try {
      await updateRecipeIngredient(ing.id, {
        name: mat.name,
        priceSource: 'supplier',
        rawMaterialId: mat.id,
      });
      await reopenRecipeEdit(toastMsg);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  };

  bindMaterialSearchRich(
    mats,
    suppliers,
    document.getElementById('change-ing-mat-search'),
    document.getElementById('change-ing-mat-id'),
    document.getElementById('change-ing-mat-list'),
    { onPick: (mat) => { applyMaterialSelection(mat); } },
  );

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
    if (newName === ing.name && !mat) return showToast('אותו חומר');
    try {
      if (mat) {
        await applyMaterialSelection(mat, 'חומר הוחלף ✓');
        return;
      }
      await updateRecipeIngredient(ing.id, {
        name: newName,
        priceSource: 'max',
        rawMaterialId: null,
      });
      await reopenRecipeEdit('חומר הוחלף ✓');
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
        await reopenRecipeEdit('תמחור עודכן ✓');
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

function refreshRecipeIngredientCosts(baseIngredients, ctx) {
  const current = readIngredientsFromForm(baseIngredients);
  document.querySelectorAll('.recipe-ing-row').forEach((row) => {
    const ing = current.find((i) => i.id === Number(row.dataset.ingId));
    if (!ing) return;
    const { lineCost, mat, status, badge } = resolveIngredientDisplay(ing, ctx);
    row.dataset.ingStatus = status;
    const costEl = row.querySelector('.recipe-ing-line-cost');
    if (costEl) costEl.textContent = mat && status !== 'no-price' ? formatMoney(lineCost) : '—';
    const nameText = row.querySelector('.recipe-ing-name-text');
    if (nameText) {
      nameText.innerHTML = `${ingredientStatusDotHTML(status)} ✏️ ${escapeHtml(ing.name)}`;
    }
    const meta = row.querySelector('.recipe-ing-price-meta');
    if (meta) meta.textContent = `${badge} · לחץ לעריכה`;
  });
}

function refreshRecipeYieldPreview(baseIngredients, baseRecipe) {
  const statsEl = document.getElementById('recipe-yield-stats');
  if (!statsEl) return;
  const ingredients = readIngredientsFromForm(baseIngredients);
  const recipe = getRecipeFormContext(baseRecipe);
  statsEl.innerHTML = renderRecipeProductYieldStatsHTML(recipe, ingredients);
}

function refreshRecipeTotalDisplay(baseIngredients, baseRecipe, ctx) {
  refreshRecipeIngredientCosts(baseIngredients, ctx);
  const el = document.getElementById('recipe-ing-total');
  if (!el) return;
  el.innerHTML = renderRecipeCostAndWeightHTML(
    readIngredientsFromForm(baseIngredients),
    getRecipeFormContext(baseRecipe),
    ctx,
  );
  refreshRecipeYieldPreview(baseIngredients, baseRecipe);
}

function formatRatioFactor(r) {
  if (!Number.isFinite(r) || r <= 0) return '—';
  const rounded = Math.round(r * 1000) / 1000;
  if (Math.abs(rounded - 1) < 0.001) return '1';
  return String(rounded).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function printRatioSnapshot(snapshot) {
  if (!snapshot?.rows?.length) {
    showToast('אין נתונים להדפסה');
    return;
  }
  const html = buildRatioPrintHtml(snapshot);
  if (!printRatioHtml(html)) {
    showToast('חסום חלון קופץ — אפשר הדפסה מהדפדפן');
  }
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
    cakeWeightKg: recipe.portionWeightGrams
      ? formatRecipeQuantity(recipe.portionWeightGrams / 1000)
      : '',
    cakeCount: '',
    scaleMode: 'anchor',
  };

  const getAnchor = () => ingredients.find((i) => i.id === Number(state.anchorId));

  const getCakeWeightGrams = () => gramsFromSubdivisionKg(state.cakeWeightKg);

  const getOriginalTotalGrams = () => recipeTotalWeightGrams(ingredients);

  const impliedUnitCount = (totalGrams, unitGrams) => {
    if (!totalGrams || !unitGrams) return null;
    const n = totalGrams / unitGrams;
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const syncPassiveInput = (input, value, formatter = (v) => v) => {
    if (!input || document.activeElement === input) return;
    input.value = formatter(value);
  };

  const render = () => {
    const anchor = getAnchor();
    if (!anchor) return;

    const baseQty = Number(anchor.quantity);
    const targetQty = Number(state.targetQty);
    let scaled;
    let ratio = 1;
    const cakeWG = getCakeWeightGrams();
    const cakeCountNum = Number(state.cakeCount);
    const useUnitsScale = state.scaleMode === 'units' && cakeCountNum > 0 && cakeWG;

    if (useUnitsScale) {
      const targetTotalG = cakeCountNum * cakeWG;
      const origG = getOriginalTotalGrams();
      scaled = scaleIngredientsToTargetGrams(ingredients, targetTotalG);
      ratio = origG > 0 ? targetTotalG / origG : 1;
      const anchorScaled = scaled.find((i) => i.id === Number(state.anchorId));
      if (anchorScaled?.scaledQuantity != null) state.targetQty = anchorScaled.scaledQuantity;
    } else {
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
    }

    const errEl = hostEl.querySelector('#ratio-error');
    if (errEl) errEl.textContent = '';

    const scaledTotalG = recipeTotalWeightGrams(scaled, { useScaled: true });
    const displayTargetQty = Number(state.targetQty);

    if (state.scaleMode === 'anchor' && cakeWG && scaledTotalG) {
      const implied = impliedUnitCount(scaledTotalG, cakeWG);
      if (implied != null) {
        state.cakeCount = String(implied);
        syncPassiveInput(
          hostEl.querySelector('#ratio-cake-count'),
          implied,
          (v) => formatRecipeQuantity(v),
        );
      }
    } else if (useUnitsScale) {
      syncPassiveInput(
        hostEl.querySelector('#ratio-target'),
        displayTargetQty,
        (v) => formatRecipeQuantity(v),
      );
    }

    const unitsInfo = cakeWG && scaledTotalG
      ? computeRecipeProductUnits(scaledTotalG / 1000, 1, cakeWG)
      : null;

    const bannerEl = hostEl.querySelector('#ratio-change-banner');
    if (bannerEl) {
      bannerEl.innerHTML = `
        <div class="ratio-change-banner-inner">
          <span class="ratio-change-label">שינוי יחס — ${escapeHtml(anchor.name)}</span>
          <span class="ratio-change-values">
            מ-<strong>${formatRecipeQuantity(baseQty)}</strong> ${escapeHtml(anchor.unit)}
            ל-<strong>${formatRecipeQuantity(displayTargetQty)}</strong> ${escapeHtml(anchor.unit)}
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
        const modeHint = useUnitsScale ? 'לפי יחידות שהוזנו' : 'לפי כמות יעד';
        yieldEl.innerHTML = `${modeHint}: <strong>${formatRecipeQuantity(unitsInfo.totalUnits)}</strong> יחידות × ${formatSubdivisionWeight(cakeWG)}`;
        yieldEl.hidden = false;
      } else if (cakeWG) {
        yieldEl.innerHTML = 'הזן כמות יעד או מספר יחידות לחישוב';
        yieldEl.hidden = false;
      } else {
        yieldEl.hidden = true;
        yieldEl.innerHTML = '';
      }
    }

    const cakesResultEl = hostEl.querySelector('#ratio-cakes-result');
    if (cakesResultEl) {
      if (useUnitsScale && cakeCountNum > 0 && cakeWG) {
        cakesResultEl.innerHTML = `
          המתכון מותאם ל-<strong>${formatRecipeQuantity(cakeCountNum)}</strong> יחידות × ${formatSubdivisionWeight(cakeWG)}
          = <strong>${formatKgWeight((cakeCountNum * cakeWG) / 1000)}</strong>
          (סה"כ מחושב: ${formatKgWeight(scaledTotalG / 1000)})`;
        cakesResultEl.hidden = false;
      } else {
        cakesResultEl.hidden = true;
        cakesResultEl.innerHTML = '';
      }
    }

    const weightSummary = getRecipeWeightSummary(scaled, { useScaled: true, recipe });
    const extras = [];
    if (yieldEl && !yieldEl.hidden && yieldEl.textContent.trim()) {
      extras.push(yieldEl.textContent.trim());
    }
    if (cakesResultEl && !cakesResultEl.hidden && cakesResultEl.textContent.trim()) {
      extras.push(cakesResultEl.textContent.trim());
    }
    hostEl._ratioPrintSnapshot = {
      recipeName: recipe.name,
      anchorName: anchor.name,
      anchorUnit: anchor.unit,
      baseQty: formatRecipeQuantity(baseQty),
      targetQty: formatRecipeQuantity(displayTargetQty),
      ratioFactor: formatRatioFactor(ratio),
      rows: scaled.map((ing) => {
        const orig = ingredients.find((i) => i.id === ing.id);
        return {
          name: ing.name,
          unit: ing.unit,
          origQty: formatRecipeQuantity(orig?.quantity),
          scaledQty: String(ing.scaledQuantity),
          isAnchor: ing.id === Number(state.anchorId),
        };
      }),
      totalText: weightSummary.mainText
        ? [weightSummary.mainText, weightSummary.breakdownText].filter(Boolean).join(' · ')
        : '',
      extras,
      printedAt: new Date().toLocaleString('he-IL'),
    };

    hostEl.querySelectorAll('.ratio-ing-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('input[type="radio"]')) return;
        const id = Number(row.dataset.ingId);
        state.anchorId = id;
        state.scaleMode = 'anchor';
        const ing = ingredients.find((i) => i.id === id);
        state.targetQty = Number(ing?.quantity) || state.targetQty;
        const targetInput = hostEl.querySelector('#ratio-target');
        if (targetInput) targetInput.value = formatRecipeQuantity(state.targetQty);
        hostEl.querySelector(`input[name="ratio-anchor-pick"][value="${id}"]`)?.click();
        render();
      });
    });

    hostEl.querySelectorAll('input[name="ratio-anchor-pick"]').forEach((radio) => {
      radio.onclick = (e) => e.stopPropagation();
      radio.onchange = () => {
        state.anchorId = Number(radio.value);
        state.scaleMode = 'anchor';
        const ing = ingredients.find((i) => i.id === state.anchorId);
        state.targetQty = Number(ing?.quantity) || 1;
        const targetInput = hostEl.querySelector('#ratio-target');
        if (targetInput) targetInput.value = formatRecipeQuantity(state.targetQty);
        render();
      };
    });
  };

  hostEl.innerHTML = `
    <div class="ratio-actions">
      <button type="button" class="btn btn-secondary btn-sm" id="ratio-print-btn">🖨️ הדפס</button>
    </div>
    <p class="form-hint ratio-intro">סמן חומר גלם לשינוי, הזן כמות יעד — או הזן משקל יחידה ומספר יחידות. השדות מסתנכרנים אוטומטית.</p>
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
      <p class="form-hint" style="margin-bottom:10px">שנה כמות יעד — יתעדכן מספר היחידות. או הזן יחידות ומשקל — המתכון יתאים ליחס.</p>
      <div class="ratio-cake-grid">
        <div class="form-group">
          <label>משקל יחידה (ק"ג)</label>
          <input type="number" id="ratio-cake-weight" min="0.001" step="0.001" placeholder="למשל: 0.1 או 3" value="${escapeHtml(state.cakeWeightKg)}">
        </div>
        <div class="form-group">
          <label>כמה יחידות?</label>
          <input type="number" id="ratio-cake-count" min="0.001" step="0.001" placeholder="למשל: 10" value="">
        </div>
      </div>
      <p id="ratio-yield-result" class="ratio-yield-result" hidden></p>
      <p id="ratio-cakes-result" class="ratio-cakes-result" hidden></p>
    </div>`;

  hostEl.querySelector('#ratio-target')?.addEventListener('input', (e) => {
    state.scaleMode = 'anchor';
    state.targetQty = Number(e.target.value);
    render();
  });

  hostEl.querySelector('#ratio-cake-weight')?.addEventListener('input', (e) => {
    state.cakeWeightKg = e.target.value;
    if (!state.cakeCount && state.scaleMode === 'units') state.scaleMode = 'anchor';
    render();
  });

  hostEl.querySelector('#ratio-cake-count')?.addEventListener('input', (e) => {
    state.cakeCount = e.target.value;
    if (state.cakeCount && state.cakeWeightKg) {
      state.scaleMode = 'units';
    } else if (!state.cakeCount) {
      state.scaleMode = 'anchor';
    }
    render();
  });

  hostEl.querySelector('#ratio-print-btn')?.addEventListener('click', () => {
    printRatioSnapshot(hostEl._ratioPrintSnapshot);
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
            <label>יבוש (דק׳)</label>
            <input type="number" id="${idPrefix}-bake-dry" min="0" step="1" placeholder="10" value="${values?.bakeDryMinutes ?? ''}">
          </div>
        </div>`;
}

function buildBakingProfileOvenBlockHTML(prefix, label, enabled, values) {
  return `
    <div class="baking-profile-oven-block" data-oven="${prefix}">
      <label class="checkbox-label baking-profile-oven-toggle">
        <input type="checkbox" id="baking-profile-oven-${prefix}" ${enabled ? 'checked' : ''}>
        <span>${escapeHtml(label)}</span>
      </label>
      <div class="recipe-baking-grid baking-profile-oven-fields${enabled ? '' : ' hidden'}" id="baking-profile-oven-${prefix}-fields">
        <div class="form-group">
          <label>טמפ׳ אפייה (°C)</label>
          <input type="number" id="baking-profile-${prefix}-temp" min="1" max="500" step="1" placeholder="180" value="${values?.bakeTempC ?? ''}">
        </div>
        <div class="form-group">
          <label>זמן אפייה (דק׳)</label>
          <input type="number" id="baking-profile-${prefix}-time" min="0" step="1" placeholder="25" value="${values?.bakeTimeMinutes ?? ''}">
        </div>
        <div class="form-group">
          <label>קיטור (שניות)</label>
          <input type="number" id="baking-profile-${prefix}-steam" min="0" step="1" placeholder="30" value="${values?.bakeSteamSeconds ?? ''}">
        </div>
        <div class="form-group">
          <label>יבוש (דק׳)</label>
          <input type="number" id="baking-profile-${prefix}-dry" min="0" step="1" placeholder="10" value="${values?.bakeDryMinutes ?? ''}">
        </div>
      </div>
    </div>`;
}

function buildBakingProfileFormFieldsHTML(profile) {
  const p = profile || {};
  const largeEnabled = profile ? !!p.ovenLargeEnabled : true;
  const smallEnabled = profile ? !!p.ovenSmallEnabled : false;
  return `
    <p class="form-hint" style="margin-top:0">סמן תנור גדול, תנור קטן, או את שניהם — לכל תנור נתונים נפרדים</p>
    ${buildBakingProfileOvenBlockHTML('large', RECIPE_OVEN_TYPES.large, largeEnabled, {
    bakeTempC: p.largeBakeTempC,
    bakeTimeMinutes: p.largeBakeTimeMinutes,
    bakeSteamSeconds: p.largeBakeSteamSeconds,
    bakeDryMinutes: p.largeBakeDryMinutes,
  })}
    ${buildBakingProfileOvenBlockHTML('small', RECIPE_OVEN_TYPES.small, smallEnabled, {
    bakeTempC: p.smallBakeTempC,
    bakeTimeMinutes: p.smallBakeTimeMinutes,
    bakeSteamSeconds: p.smallBakeSteamSeconds,
    bakeDryMinutes: p.smallBakeDryMinutes,
  })}`;
}

function bindBakingProfileOvenToggles() {
  ['large', 'small'].forEach((prefix) => {
    const cb = document.getElementById(`baking-profile-oven-${prefix}`);
    const fields = document.getElementById(`baking-profile-oven-${prefix}-fields`);
    cb?.addEventListener('change', () => {
      fields?.classList.toggle('hidden', !cb.checked);
    });
  });
}

function readBakingProfileOvensFromForm() {
  const readOven = (prefix) => ({
    bakeTempC: document.getElementById(`baking-profile-${prefix}-temp`)?.value,
    bakeTimeMinutes: document.getElementById(`baking-profile-${prefix}-time`)?.value,
    bakeSteamSeconds: document.getElementById(`baking-profile-${prefix}-steam`)?.value,
    bakeDryMinutes: document.getElementById(`baking-profile-${prefix}-dry`)?.value,
  });
  const largeOn = !!document.getElementById('baking-profile-oven-large')?.checked;
  const smallOn = !!document.getElementById('baking-profile-oven-small')?.checked;
  const large = readOven('large');
  const small = readOven('small');
  return {
    ovenLargeEnabled: largeOn,
    ovenSmallEnabled: smallOn,
    largeBakeTempC: large.bakeTempC,
    largeBakeTimeMinutes: large.bakeTimeMinutes,
    largeBakeSteamSeconds: large.bakeSteamSeconds,
    largeBakeDryMinutes: large.bakeDryMinutes,
    smallBakeTempC: small.bakeTempC,
    smallBakeTimeMinutes: small.bakeTimeMinutes,
    smallBakeSteamSeconds: small.bakeSteamSeconds,
    smallBakeDryMinutes: small.bakeDryMinutes,
  };
}

function buildBakingProfileSelectOptions(profiles, selectedId) {
  const parts = ['<option value="">— הגדרות ידניות —</option>'];
  for (const p of profiles) {
    const sel = Number(selectedId) === p.id ? ' selected' : '';
    const hint = formatBakingProfileOvensSummary(p);
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
    const ovens = getEnabledBakingOvens(profile);
    const rows = [];
    for (const oven of ovens) {
      rows.push({ label: oven.label, value: formatOvenBakeParamsLine(oven) || 'ללא פרטים' });
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
  if (baking.ovens?.length) {
    for (const oven of baking.ovens) {
      rows.push({ label: oven.label, value: formatOvenBakeParamsLine(oven) || 'ללא פרטים' });
    }
  } else {
    if (baking.bakeOvenType) rows.push({ label: 'תנור', value: getRecipeOvenLabel(baking.bakeOvenType) });
    if (baking.bakeTempC) rows.push({ label: 'טמפ׳ אפייה', value: `${baking.bakeTempC}°C` });
    if (baking.bakeTimeMinutes != null && baking.bakeTimeMinutes !== '') {
      rows.push({ label: 'זמן אפייה', value: `${baking.bakeTimeMinutes} דק׳` });
    }
    if (baking.bakeSteamSeconds != null && baking.bakeSteamSeconds !== '') {
      rows.push({ label: 'קיטור', value: `${baking.bakeSteamSeconds} שניות` });
    }
    if (baking.bakeDryMinutes != null && baking.bakeDryMinutes !== '') {
      rows.push({ label: 'יבוש', value: `${baking.bakeDryMinutes} דק׳` });
    }
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

  const paramsLine = formatBakingProfileOvensSummary(profile);

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
    reloadBakingTab(container);
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

  const reopenLinksFresh = async (opts = {}) => {
    closeModal();
    await reloadBakingTab(container);
    const ctx = await loadFreshBakingContext();
    openBakingProfileLinksModal(container, profileId, ctx, opts);
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
        await reopenLinksFresh({ focusAdd: true });
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
      showToast('מתכון שויך ✓');
      await reopenLinksFresh();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.querySelectorAll('.unlink-baking-product').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await unlinkProductFromBakingProfile(profileId, Number(btn.dataset.productId));
        showToast('הוסר ✓');
        await reopenLinksFresh();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.querySelectorAll('.unlink-baking-scope').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await unlinkBakingProfileScope(profileId, btn.dataset.scopeType, Number(btn.dataset.scopeId));
        showToast('הוסר ✓');
        await reopenLinksFresh();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.querySelectorAll('.unlink-baking-recipe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await unlinkRecipeFromBakingProfile(Number(btn.dataset.recipeId));
        showToast('הוסר ✓');
        await reopenLinksFresh();
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
        <input type="text" id="baking-profile-name" maxlength="60" placeholder="למשל: בצק חמאה" value="${profile ? escapeHtml(profile.name) : ''}">
      </div>
      ${buildBakingProfileFormFieldsHTML(profile)}
      <div class="form-group">
        <label>הערות (אופציונלי)</label>
        <textarea id="baking-profile-notes" rows="2">${profile ? escapeHtml(profile.notes || '') : ''}</textarea>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-baking-profile">שמור</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  bindBakingProfileOvenToggles();
  document.getElementById('save-baking-profile')?.addEventListener('click', async () => {
    const name = document.getElementById('baking-profile-name')?.value.trim();
    const notes = document.getElementById('baking-profile-notes')?.value || '';
    const data = { name, notes, ...readBakingProfileOvensFromForm() };
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

function buildRecipeViewHTML(recipe, { categoryPath, linkedNames, productCategoryName, profileMap, matCtx, subRecipes = [] }) {
  const ingredients = recipe.ingredients || [];
  const weightSummaryHtml = renderRecipeWeightSummaryHTML(ingredients, recipe);
  const { units, summary } = getRecipeProductYieldInfo(recipe, ingredients);
  const yieldBlockHtml = renderRecipeProductYieldBlockHTML(recipe, ingredients, { showCalculator: true });
  const isSubRecipe = !!recipe.parentRecipeId;
  let totalCost = 0;
  const ingredientRows = ingredients.map((ing, i) => {
    const { lineCost, mat, status } = matCtx
      ? resolveIngredientDisplay(ing, matCtx)
      : { lineCost: 0, mat: null, status: 'unlinked' };
    totalCost += lineCost;
    return `
              <tr>
                <td class="col-num">${i + 1}</td>
                <td class="col-name">${ingredientStatusDotHTML(status)} ${escapeHtml(ing.name)}</td>
                <td class="col-qty"><span class="recipe-qty-value">${formatRecipeQuantity(ing.quantity)}</span></td>
                <td class="col-unit">${escapeHtml(ing.unit)}</td>
                <td class="col-cost">${mat && status !== 'no-price' ? formatMoney(lineCost) : '—'}</td>
              </tr>`;
  }).join('');

  return `
    <article class="recipe-sheet${isSubRecipe ? ' recipe-sub-recipe-sheet' : ''}">
      ${isSubRecipe ? '<div class="recipe-sub-recipe-banner">תת מתכון</div>' : ''}
      <header class="recipe-sheet-header">
        ${categoryPath ? `<p class="recipe-sheet-breadcrumb">${escapeHtml(categoryPath)}</p>` : ''}
        <h1 class="recipe-sheet-title">${escapeHtml(recipe.name)}</h1>
        <div class="recipe-sheet-meta">
          <span class="recipe-meta-pill">🍽 מנה אחת${summary.totalRecipeKg > 0 ? ` · ${formatKgWeight(summary.totalRecipeKg)}` : ''}</span>
          ${recipe.portionWeightGrams ? `<span class="recipe-meta-pill">⚖️ יחידת חלוקה: ${formatSubdivisionWeight(recipe.portionWeightGrams)}</span>` : ''}
          ${units ? `<span class="recipe-meta-pill recipe-meta-yield">📦 ${formatRecipeQuantity(units.totalUnits)} יחידות</span>` : ''}
          ${productCategoryName ? `<span class="recipe-meta-pill">🏷️ ${escapeHtml(productCategoryName)}</span>` : ''}
          ${linkedNames?.length ? `<span class="recipe-meta-pill recipe-meta-products">🔗 ${linkedNames.map((n) => escapeHtml(n)).join(' · ')}</span>` : ''}
        </div>
      </header>
      ${yieldBlockHtml}
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
                <th scope="col" class="col-cost">מחיר חומר גלם</th>
              </tr>
            </thead>
            <tbody>
              ${ingredientRows}
              <tr class="recipe-cost-total-row">
                <td colspan="4" class="recipe-cost-total-label">סה״כ עלות למנה</td>
                <td class="col-cost"><strong>${formatMoney(totalCost)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
        ${weightSummaryHtml}` : '<p class="recipe-sheet-empty">אין חומרי גלם — לחץ «עריכה» להוספה</p>'}
      </section>
      ${buildRecipeBakingViewHTML(recipe, profileMap)}
      <section class="recipe-sheet-section recipe-sheet-notes-block">
        <h2 class="recipe-sheet-section-title">הערות / דרך הכנה</h2>
        ${recipe.notes?.trim()
          ? `<p class="recipe-sheet-notes">${escapeHtml(recipe.notes.trim())}</p>`
          : `<p class="recipe-sheet-notes-empty">אין הערות עדיין — אפשר להוסיף דרך הכנה, טיפים או הערות (אופציונלי).</p>`}
      </section>
    </article>
    ${subRecipes.map((sub) => buildRecipeViewHTML(sub, {
      categoryPath, linkedNames, productCategoryName, profileMap, matCtx, subRecipes: [],
    })).join('')}`;
}

async function openRecipeView(container, recipe, { productCatalog, layout }) {
  const [products, profiles, mats, suppliers, subRecipeRows] = await Promise.all([
    getProducts(true), getBakingProfiles(), getRawMaterials(), getSuppliers(),
    recipe.parentRecipeId ? Promise.resolve([]) : getRecipeSubRecipes(recipe.id),
  ]);
  const subRecipes = await Promise.all(subRecipeRows.map((row) => getRecipe(row.id)));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const matCtx = buildRecipeMaterialContext(mats, suppliers);
  const linkedNames = sortProductIdsByCatalogOrder(recipe.linkedProductIds || [], productCatalog)
    .map((id) => productMap.get(id)?.name).filter(Boolean);
  const categoryPath = findRecipeCategoryPath(layout, recipe.categoryId);
  const productLinkLabel = formatRecipeProductLinkLabel(recipe, productCatalog);

  openModal({
    title: '',
    modalClass: 'modal-recipe-view',
    bodyHTML: buildRecipeViewHTML(recipe, {
      categoryPath, linkedNames, productCategoryName: productLinkLabel, profileMap, matCtx, subRecipes,
    }),
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">סגור</button>
      <button type="button" class="btn btn-secondary" id="recipe-view-notes">📝 הערות / הכנה</button>
      <button type="button" class="btn btn-secondary" id="recipe-view-ratio">⚖️ יחס</button>
      ${!recipe.parentRecipeId ? '<button type="button" class="btn btn-secondary" id="recipe-add-sub">+ תת מתכון</button>' : ''}
      <button type="button" class="btn btn-primary" id="recipe-view-edit">✏️ עריכה</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('recipe-view-notes')?.addEventListener('click', () => {
    openRecipeNotesEditor(container, recipe, { productCatalog, layout });
  });
  document.getElementById('recipe-view-edit')?.addEventListener('click', () => {
    closeModal();
    openRecipeForm(container, { recipe, productCatalog, layout, returnToView: true });
  });
  document.getElementById('recipe-add-sub')?.addEventListener('click', async () => {
    const name = prompt('שם תת המתכון (תוספת למוצר):', `${recipe.name} — תוספת`);
    if (name === null) return;
    try {
      const subId = await addSubRecipe(recipe.id, { name: name.trim() });
      closeModal();
      const sub = await getRecipe(subId);
      showToast('תת מתכון נוצר ✓');
      openRecipeForm(container, { recipe: sub, productCatalog, layout, returnToView: true });
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
  document.getElementById('recipe-view-ratio')?.addEventListener('click', () => {
    sessionStorage.setItem(RATIO_RECIPE_KEY, String(recipe.id));
    closeModal();
    switchRecipeTab('ratio');
  });

  bindRecipeProductionCalculator(recipe, recipe.ingredients || [], matCtx);
}

function openRecipeNotesEditor(container, recipe, { productCatalog, layout }) {
  openModal({
    title: `הערות / דרך הכנה — ${recipe.name}`,
    bodyHTML: `
      <p class="form-hint" style="margin-top:0">אופציונלי — דרך הכנה, טיפים או הערות למתכון זה.</p>
      ${recipeNotesFieldHTML(recipe.notes)}`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="recipe-notes-save">שמור</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', () => {
    closeModal();
    openRecipeView(container, recipe, { productCatalog, layout });
  });
  document.getElementById('recipe-notes-save')?.addEventListener('click', async () => {
    const notes = document.getElementById('recipe-notes')?.value?.trim() || '';
    try {
      await updateRecipe(recipe.id, { notes });
      const updated = await getRecipe(recipe.id);
      closeModal();
      showToast('הערות נשמרו ✓');
      openRecipeView(container, updated || { ...recipe, notes }, { productCatalog, layout });
    } catch (err) {
      showToast(err.message || 'שגיאה בשמירה');
    }
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
  bindMaterialSearchRich(mats, [], input, hidden, list);
}

function bindMaterialSearchRich(mats, suppliers, input, hidden, list, { onPick } = {}) {
  if (!input || !hidden || !list) return;
  const supMap = new Map((suppliers || []).map((s) => [s.id, s.name]));

  const renderList = (filter = '') => {
    const q = filter.trim();
    const filtered = q
      ? mats.filter((m) => materialMatchesSearch(m, q, { supplierName: supMap.get(m.supplierId) || '' }))
      : mats.slice(0, 50);
    list.innerHTML = filtered.map((m) => {
      const sup = supMap.get(m.supplierId) || '';
      const synonyms = getMaterialSynonyms(m);
      const synonymHint = synonyms.length ? ` · גם: ${synonyms.slice(0, 2).join(', ')}` : '';
      const meta = sup
        ? `${escapeHtml(sup)} · ${formatMoney(m.unitPrice)}/${escapeHtml(m.unit || '')}${escapeHtml(synonymHint)}`
        : `${formatMoney(m.unitPrice)}${escapeHtml(synonymHint)}`;
      return `
      <li>
        <button type="button" class="mat-search-option mat-search-option-rich" data-id="${m.id}">
          <span class="mat-search-option-name">${escapeHtml(m.name)}</span>
          <span class="mat-search-option-meta">${meta}</span>
        </button>
      </li>`;
    }).join('');
    list.classList.toggle('hidden', filtered.length === 0);
  };

  input.addEventListener('input', () => {
    hidden.value = '';
    renderList(input.value);
  });
  input.addEventListener('focus', () => renderList(input.value));
  list.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.mat-search-option');
    if (!btn) return;
    e.preventDefault();
    const mat = mats.find((m) => m.id === Number(btn.dataset.id));
    if (!mat) return;
    hidden.value = String(mat.id);
    input.value = mat.name;
    list.classList.add('hidden');
    if (onPick) onPick(mat);
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.mat-search-option');
    if (!btn || onPick) return;
    hidden.value = btn.dataset.id;
    input.value = mats.find((m) => m.id === Number(btn.dataset.id))?.name || '';
    list.classList.add('hidden');
  });
  input.addEventListener('blur', () => {
    setTimeout(() => list.classList.add('hidden'), 150);
  });
}

function bindMaterialSearchPicker(mats, suppliers) {
  bindMaterialSearchRich(
    mats,
    suppliers || [],
    document.getElementById('new-ing-mat-search'),
    document.getElementById('new-ing-mat'),
    document.getElementById('new-ing-mat-list'),
  );
}

async function openRecipeForm(container, { recipe, categoryId, productCatalog, layout, returnToView, draft }) {
  const isEdit = !!recipe;
  const ingredients = recipe?.ingredients || [];
  const [mats, bakingProfiles, suppliers] = await Promise.all([
    getRawMaterials(), getBakingProfiles(), getSuppliers(),
  ]);
  const matCtx = buildRecipeMaterialContext(mats, suppliers);
  const catalog = productCatalog || await getProductsCatalogLayout();
  const catalogLayout = layout || container._recipeLayout;
  const selectedCategoryId = recipe?.categoryId || categoryId || '';
  const placementHTML = !recipe?.parentRecipeId && catalogLayout
    ? buildRecipePlacementFieldsHTML(catalogLayout.groups, selectedCategoryId)
    : '';

  openModal({
    title: isEdit ? (recipe?.parentRecipeId ? 'עריכת תת מתכון' : 'עריכת מתכון') : 'מתכון חדש',
    modalClass: isEdit ? 'modal-recipe-edit' : 'modal-recipe-new',
    bodyHTML: `
      <div class="form-group">
        <label>שם מתכון</label>
        <input type="text" id="recipe-name" value="${recipe ? escapeHtml(recipe.name) : ''}" placeholder="לדוגמה: בצק שמרים" autofocus>
      </div>
      ${placementHTML}
      <div class="form-group">
        <label for="recipe-subdivision-kg">משקל יחידת חלוקה (ק"ג)</label>
        <input type="number" id="recipe-subdivision-kg" min="0.001" step="0.001" placeholder="למשל: 3 — משקל כל כדור/יחידה" value="${recipe?.portionWeightGrams ? formatRecipeQuantity(recipe.portionWeightGrams / 1000) : ''}">
        <p class="form-hint">המתכון כולו = מנה אחת. הזן איך מחלקים אותה — למשל כדורי 3 ק"ג מתוך 70 ק"ג בצק</p>
      </div>
      ${isEdit ? `
      <section class="recipe-sheet-section recipe-product-yield-section recipe-yield-preview" aria-label="תשואת מוצרים">
        <h2 class="recipe-sheet-section-title">תשואת מוצרים</h2>
        <div id="recipe-yield-stats" class="recipe-yield-stats"></div>
        <div class="recipe-production-calc">
          <label class="recipe-production-calc-label" for="recipe-target-products">כמה יחידות לייצר?</label>
          <input type="number" id="recipe-target-products" class="recipe-target-products-input" min="0.1" step="0.1" placeholder="למשל: 24">
          <div id="recipe-scaled-ingredients-host" class="recipe-scaled-ingredients-host" hidden></div>
        </div>
      </section>` : ''}
      <div class="form-group recipe-product-link-block">
        ${recipe?.parentRecipeId
    ? '<p class="form-hint recipe-sub-link-hint">שיוך מוצר יורש מהמתכון הראשי — יופיע באותן מנות</p>'
    : buildOptionalProductLinkerHTML(catalog, recipe)}
      </div>
      ${buildRecipeBakingFormHTML(recipe, bakingProfiles)}
      ${isEdit ? `
      <div class="form-group">
        <label>חומרי גלם</label>
        ${ingredients.length ? `${renderRecipeIngredientsHeaderHTML()}${ingredients.map((ing) => renderRecipeIngredientRowHTML(ing, matCtx)).join('')}` : '<p class="form-hint">אין חומרים</p>'}
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
      </div>
      ${recipeNotesFieldHTML(recipe?.notes)}` : `
      ${recipeNotesFieldHTML()}
      <p class="form-hint recipe-new-next-hint">אחרי שמירה ייפתח עורך המתכון — שם תוכל להוסיף חומרי גלם ולבנות את המנה.</p>`}`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-recipe">${isEdit ? 'שמור' : 'צור מתכון והמשך'}</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  if (catalogLayout && !recipe?.parentRecipeId) {
    bindRecipePlacementFields(catalogLayout.groups);
  }

  if (!recipe?.parentRecipeId) bindOptionalProductLinker(catalog, recipe);

  bindRecipeBakingFormToggle(bakingProfiles);

  if (draft) applyRecipeFormDraft(draft);

  if (isEdit) bindMaterialSearchPicker(mats, suppliers);

  if (isEdit) {
    refreshRecipeYieldPreview(ingredients, recipe);
    bindRecipeProductionCalculator(recipe, ingredients, matCtx, {
      getRecipe: () => getRecipeFormContext(recipe),
      getIngredients: () => readIngredientsFromForm(ingredients),
    });
  }

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
        openIngredientSupplierPicker(
          container, recipe, ing, matCtx, mats, suppliers, catalog, catalogLayout, returnToView, readRecipeFormDraft(),
        );
      }
    });
  });

  document.getElementById('recipe-subdivision-kg')?.addEventListener('input', () => {
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
    const recipeCategoryId = Number(document.getElementById('recipe-category')?.value) || categoryId;
    const subdivisionKg = document.getElementById('recipe-subdivision-kg')?.value?.trim();
    const data = {
      name: document.getElementById('recipe-name').value.trim(),
      yieldPortions: 1,
      showTotalAsPortions: false,
      portionWeightGrams: subdivisionKg ? gramsFromSubdivisionKg(subdivisionKg) : null,
      notes: document.getElementById('recipe-notes').value,
      ...(recipe?.parentRecipeId ? {} : readRecipeProductLinkFromForm()),
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
        if (!recipeCategoryId) {
          showToast('בחר קטגוריה כללית וקטגוריה למתכון');
          return;
        }
        const newId = await addRecipe({ ...data, categoryId: recipeCategoryId });
        expandRecipeCategory(recipeCategoryId);
        closeModal();
        showToast('מתכון נוצר ✓ — אפשר להוסיף חומרי גלם');
        const created = await getRecipe(newId);
        openRecipeForm(container, {
          recipe: created,
          productCatalog: catalog,
          layout: catalogLayout,
        });
      }
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}
